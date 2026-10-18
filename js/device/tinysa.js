// tinysa.js — the tinySA API. Method names mirror the tsapython library (4.0.0).
// SPDX-License-Identifier: GPL-2.0-only
//
// This is the layer another tool would reuse. Callers never see "ch>" — they
// get strings and typed arrays. One ShellLink (serial or demo) underneath.
//
// What 4.0.0 added here, all ported from tsapython/core.py and _identify.py:
//   - identify(): board + firmware build from `version`/`info`; the device's own
//     `help` list decides which commands the page will send (has()).
//   - classifyReply(): a `usage:` line, `name?`, or a refusal is an error; the
//     page's methods throw a DeviceError with .status, and lastStatus keeps it.
//   - output gate: outputAllowed must be true before `output on|normal|mixer`
//     or `caloutput <freq>` is sent.
//   - output-mode rules: setupGenerator()/setGenerator() pause the sweep around
//     settings; a 0.4 s settle follows `output`/`modulation`/`caloutput`/
//     `leveloffset`; "Command timeout" ends a reply and idempotent setters are
//     resent once; commands over 47 bytes are refused before sending.
//
// A sweep is { pts, start, stop, f: Float64Array, dbm: Float32Array, t, ms, cmd, method }.
import { MODELS, DEFAULT_MODEL, identifyDevice, FIRMWARE_FLOOR, buildAtLeast } from './models.js';
import { PROMPT } from './shell-link.js';

/** Reply statuses, the same words tsapython writes to its log file. */
export const STATUS = { OK: 'ok', BLOCKED: 'blocked', USAGE: 'usage', UNKNOWN: 'unknown-command', REFUSED: 'device-refused', TIMEOUT: 'timeout' };

/** Messages the firmware prints when it refuses a well-formed command. */
const DEVICE_REFUSALS = ['usb disk mode active', 'Command timeout', 'frequency range is invalid', 'sweep points exceeds range',
  'scan point count is invalid', 'sweep point count is invalid', 'Key unmatched'];
/** A few commands print their usage without the 'usage:' prefix. */
const BARE_USAGE_PREFIXES = ['save {id}', 'recall {id}', 'trigger {value}', 'trace {', 'marker [n]', 'channel [1-3]', 'leveloffset ['];

/** The firmware's command line holds 48 bytes; characters past the 47th are neither stored nor echoed. */
export const MAX_COMMAND_LENGTH = 47;
/** Settle after the setters that run in the shell thread and leave a redraw pending (see PROTOCOL.md, "Output mode"). */
export const SETTLE_AFTER_IMMEDIATE_SETTER_MS = 400;
const IMMEDIATE_SETTERS = new Set(['output', 'modulation', 'caloutput', 'leveloffset']);
/** Resent once after "Command timeout": setters whose second application is harmless. */
const RETRY_AFTER_COMMAND_TIMEOUT = new Set('pause resume level sweep mode rbw attenuate calc spur sweeptime ext_gain levelchange trigger marker trace if if1 lna lna2 agc ultra direct correction zero avoid'.split(' '));

/**
 * Classify a cleaned reply the way tsapython's classify_reply() does.
 * A usage line is a rejection only when the command carried an argument; a bare
 * command or one with '?' is a query and the usage line IS its answer.
 */
export function classifyReply(sent, body) {
  const words = (sent || '').trim().split(/\s+/);
  const name = words[0] || '';
  const isQuery = words.length <= 1 || words[1].startsWith('?');
  const text = (body || '').trim();
  if (text === '') return { status: STATUS.OK, reason: '' };
  if (name && text === name + '?') return { status: STATUS.UNKNOWN, reason: `this firmware does not have the '${name}' command` };
  for (const r of DEVICE_REFUSALS) if (text.includes(r)) return { status: STATUS.REFUSED, reason: 'device replied: ' + r };
  if (!isQuery && (text.includes('usage:') || BARE_USAGE_PREFIXES.some(p => text.startsWith(p)))) return { status: STATUS.USAGE, reason: 'device rejected the argument' };
  return { status: STATUS.OK, reason: '' };
}
/** Kept for older callers: true when the reply reads as a rejection of a command with an argument. */
export function looksLikeError(body, sent = 'x y') { return classifyReply(sent, body).status !== STATUS.OK; }

export class DeviceError extends Error {
  constructor(message, status, reply = '') { super(message); this.name = 'DeviceError'; this.status = status; this.reply = reply; }
}

/**
 * Some Jan-2024 firmware builds print a level as "-:.000000e+01": the firmware
 * overflows a single digit slot, so what should read "10" renders as ":".
 * tsapython's examples replace the colon form with 10 (negative first). Same here.
 * Fixed in firmware v1.4-230; harmless on later builds.
 */
export const fixColon = s => s.replace(/-:\.0/g, '-10.0').replace(/:\.0/g, '10.0');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const enc = new TextEncoder();

export class TinySA {
  constructor(link) {
    this.link = link;
    this.model = DEFAULT_MODEL;
    this.ident = { version: '', info: '', modelName: '', label: '', hw: '', board: 'unknown', build: null, family: 'unknown', firmware: '' };
    this.deviceCommands = null;        // Set from `help`, or null when it could not be read
    this.deviceSweep = null; this.paused = false; this.sweepChanged = false; this.wedged = false;
    this.outputAllowed = false;        // the RF output gate (tsapython set_output_allowed)
    this.lastStatus = STATUS.OK;       // how the last command ended (tsapython get_last_status)
    this.onWarning = null;             // (text) => void
  }
  get env() { return MODELS[this.model]; }
  /** scanraw scale factor: by model unless overridden. */
  get scale() { return this.scaleOverride ?? this.env.scale; }
  /** Does the connected firmware have this command? The device's `help` list wins; the profile is the fallback. */
  has(cmd) { return this.deviceCommands ? this.deviceCommands.has(cmd) : this.env.commands.has(cmd); }
  /** Firmware build at least v1.4-n? false when the build is unknown. */
  buildAtLeast(n) { return buildAtLeast(this.ident.build, [1, 4, n]); }
  _warn(t) { if (this.onWarning) this.onWarning(t); }

  // ---- the one path every command takes --------------------------------------
  /**
   * Send a command string. Resolves with { body, raw, ms, status, reason }.
   * Throws DeviceError (status 'blocked') before sending when the command is too
   * long; 'timeout' when no prompt arrives. After a reply, status says how the
   * device took it; callers that want an exception on a rejection use _ok().
   */
  async _cmd(cmd, opts = {}) {
    cmd = cmd.trim();
    if (enc.encode(cmd).length > MAX_COMMAND_LENGTH) this._blocked(cmd.split(/\s+/)[0], `command is ${enc.encode(cmd).length} bytes; the firmware's command line holds ${MAX_COMMAND_LENGTH}`);
    const name = cmd.split(/\s+/)[0];
    const { noRetry, ...linkOpts } = opts;
    const run = async () => {
      let r;
      try { r = await this.link.command(cmd, { requireEcho: true, terminators: ['Command timeout'], ...linkOpts }); }
      catch (e) { this.lastStatus = STATUS.TIMEOUT; throw new DeviceError(e.message, STATUS.TIMEOUT); }
      return { ...r, ...classifyReply(cmd, r.body) };
    };
    let r = await run();
    if (r.status === STATUS.REFUSED && r.body.includes('Command timeout') && RETRY_AFTER_COMMAND_TIMEOUT.has(name) && !noRetry) {
      // the sweep thread never ran it (see PROTOCOL.md "Output mode"); queue it once more
      this._warn(`device said "Command timeout" for "${cmd}"; sending it once more`);
      r = await run();
    }
    this.lastStatus = r.status;
    const words = cmd.split(/\s+/);
    if (r.status === STATUS.OK && words.length >= 2 && IMMEDIATE_SETTERS.has(name) && !words[1].startsWith('?')) await sleep(SETTLE_AFTER_IMMEDIATE_SETTER_MS);
    return r;
  }
  /** _cmd(), then throw a DeviceError if the device did not accept it. */
  async _ok(cmd, what, opts) {
    const r = await this._cmd(cmd, opts);
    if (r.status !== STATUS.OK) throw new DeviceError(`${what}: ${r.reason} ("${r.body.trim().split('\n')[0]}")`, r.status, r.body);
    return r;
  }
  _blocked(what, why) { this.lastStatus = STATUS.BLOCKED; throw new DeviceError(`${what}: ${why}`, STATUS.BLOCKED); }
  /** Refuse before sending when the connected device lacks the command. */
  _need(cmd) { if (!this.has(cmd)) this._blocked(cmd, `this ${this.env.name} firmware does not have '${cmd}'`); }
  _word(cmd, word, words) { if (!words.includes(String(word))) this._blocked(cmd, `'${word}' is not accepted on the ${this.env.name}; it takes ${words.join('|')}`); }

  // ---- identity / system -------------------------------------------------
  async version()  { return (await this._cmd('version',  { timeoutMs: 3000 })).body.trim(); }
  async info()     { return (await this._cmd('info',     { timeoutMs: 3000 })).body.trim(); }
  async deviceId() { return (await this._cmd('deviceid', { timeoutMs: 3000 })).body.trim(); }
  async vbat()     { return (await this._cmd('vbat',     { timeoutMs: 3000 })).body.trim(); }   // "4154 mV"
  async status()   { return (await this._cmd('status',   { timeoutMs: 3000 })).body.trim(); }   // "Resumed" | "Paused"
  async help()     { return (await this._cmd('help',     { timeoutMs: 4000, quiet: true })).body; }

  /** version + info + help; throws if the port doesn't answer like a tinySA console. */
  async identify(modelOverride) {
    const v = await this.link.command('version', { timeoutMs: 3000 });
    const i = await this.link.command('info', { timeoutMs: 3000 });
    if (!v.raw.includes(PROMPT)) throw new Error('that port did not answer like a tinySA console');
    const id = identifyDevice(v.body, i.body);
    this.ident = { version: v.body.trim(), info: i.body.trim(), ...id, label: '' };
    this.model = modelOverride && MODELS[modelOverride] ? modelOverride : id.key;
    const boardNote = id.board !== 'unknown' && !(id.modelName || '').includes(id.board) ? ` ${id.board}` : '';
    this.ident.label = `${id.modelName || id.firmware}${boardNote} · ${id.firmware}${id.hw ? ' · HW ' + id.hw : ''}`;
    try {
      const h = await this.help();
      // "commands: a b c\nOther commands: d e f" — every word that is not a heading
      const names = h.replace(/\r/g, '').split('\n').flatMap(l => l.replace(/^[^:]*commands:/i, '').trim().split(/\s+/)).filter(w => /^[a-z_0-9]+$/i.test(w));
      this.deviceCommands = names.length > 10 ? new Set(names) : null;
    } catch { this.deviceCommands = null; }
    if (id.build && !buildAtLeast(id.build, FIRMWARE_FLOOR)) this._warn(`firmware ${id.firmware} is older than v1.4-${FIRMWARE_FLOOR[2]}, the oldest build this page is written for; some commands may differ`);
    if (id.family === 'unknown') this._warn('could not tell the model from the version/info replies; using the generic envelope');
    try { this.deviceSweep = await this.sweep(); } catch { this.deviceSweep = null; }
    return this.ident;
  }
  /** Put the device back on the sweep it had when we connected. */
  async restoreDeviceSweep() { const d = this.deviceSweep; if (this.sweepChanged && d && Number.isFinite(d.start) && Number.isFinite(d.stop)) { await this.sweep(d.start, d.stop, d.pts); this.sweepChanged = false; } }

  // ---- sweep control -----------------------------------------------------
  // Between-sweeps commands (pause, resume, sweep, level, mode, rbw, ...) are run
  // by the firmware's sweep thread; the shell gives up after 20 s with "Command
  // timeout", so their timeout here is a little above that.
  async pause()  { const r = await this._ok('pause', 'pause', { timeoutMs: 25000 }); this.paused = true; return r; }
  async resume() { const r = await this._ok('resume', 'resume', { timeoutMs: 25000 }); this.paused = false; return r; }
  /**
   * sweep() -> {start, stop, pts}; sweep(a, b, n) sets; sweep('center', hz) etc.
   * tsapython: config_sweep / run_sweep. The reply to a bare "sweep" is
   * "start stop points" on current firmware.
   */
  async sweep(a, b, pts) {
    if (a == null) { const n = (await this._cmd('sweep')).body.trim().split(/\s+/).map(Number); return { start: n[0], stop: n[1], pts: n[2] }; }
    this.sweepChanged = true;
    if (typeof a === 'string') return this._ok(`sweep ${a} ${Math.round(b)}`, `sweep ${a}`, { timeoutMs: 25000 });
    if (!(a < b)) this._blocked('sweep', 'start must be below stop');
    return this._ok(`sweep ${Math.round(a)} ${Math.round(b)}${pts ? ' ' + pts : ''}`, 'sweep', { timeoutMs: 25000 });
  }
  async sweepTime(v) { return this._ok(`sweeptime ${v}`, 'sweeptime', { timeoutMs: 25000 }); }
  async frequencies() { return (await this._cmd('frequencies')).body.split('\n').map(Number).filter(Number.isFinite); }
  /** waitscan [n]: let n sweeps complete, then pause (firmware v1.4-216+). */
  async waitscan(n = 1) { this._need('waitscan'); return this._ok(`waitscan ${n}`, 'waitscan', { timeoutMs: 120000 }); }

  // ---- acquisition -------------------------------------------------------
  /** data(0|1|2): the device's current trace in dBm (0 temp, 1 stored, 2 measurement). */
  async data(ch = 0) {
    const body = fixColon((await this._cmd(`data ${ch}`)).body);
    return Float32Array.from(body.split('\n').map(l => parseFloat(l)).filter(Number.isFinite));
  }

  _clip(start, stop, pts) {
    const m = this.env, top = m.maxHzUltra;
    start = Math.round(Math.min(Math.max(start, 0), top));
    stop = Math.round(Math.min(Math.max(stop, 0), top));
    if (!(start < stop)) stop = Math.min(top, start + 1e6);
    pts = Math.min(Math.max(Math.round(pts), m.minPts), m.maxPts);
    return { start, stop, pts };
  }

  /**
   * scan(start, stop, pts): one sweep with outmask 3 (frequency + level).
   * Text path, ~"freq level 0.000000000 " per line. Validates the point
   * count; retries once; throws with detail if the device never completes.
   */
  async scan(start, stop, pts, { retries = 1, quiet = false } = {}) {
    ({ start, stop, pts } = this._clip(start, stop, pts));
    const cmd = `scan ${start} ${stop} ${pts} 3`;
    this.sweepChanged = true;
    let last = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const r = await this._cmd(cmd, { timeoutMs: 8000 + pts * 40, quiet });
      if (r.status !== STATUS.OK) throw new DeviceError(`scan: ${r.reason} ("${r.body.trim().split('\n')[0]}")`, r.status, r.body);
      const parsed = TinySA.parseScan(r.body, pts);
      if (parsed) return { ...parsed, pts, start, stop, t: Date.now(), ms: r.ms, cmd, method: 'scan', glitches: (r.body.match(/:\.0/g) || []).length };
      last = { lines: r.body.split('\n').filter(Boolean).length, expected: pts, attempt };
    }
    const err = new Error(`scan returned ${last.lines} usable lines, expected ${last.expected}`);
    err.detail = last; throw err;
  }
  static parseScan(body, pts) {
    const f = new Float64Array(pts), dbm = new Float32Array(pts); let n = 0;
    for (const line of fixColon(body).split('\n')) {
      const v = line.trim().split(/\s+/); if (v.length < 2 || n >= pts) continue;
      const a = Number(v[0]), b = Number(v[1]); if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      f[n] = a; dbm[n] = b; n++;
    }
    return n === pts ? { f, dbm } : null;
  }

  /**
   * scanRaw(start, stop, pts): binary sweep. The frame is
   *   '{' + pts × ('x' + uint16 little-endian) + '}'   then the prompt.
   * dBm = value / 32 − scale (174 Ultra, 128 Basic). unbuf 0 or 1 only: since
   * firmware v1.4-177 the last argument is a bit field and 2 (repeat) streams
   * frames until `pause`, which this one-frame reader cannot consume.
   * Frequencies are reconstructed with linspace, as the library's examples do.
   */
  async scanRaw(start, stop, pts, { unbuf = 1, quiet = false } = {}) {
    if (unbuf !== 0 && unbuf !== 1) this._blocked('scanraw', 'unbuf must be 0 or 1 (2 = continuous stream, not a single frame)');
    ({ start, stop, pts } = this._clip(start, stop, pts));
    const cmd = `scanraw ${start} ${stop} ${pts} ${unbuf}`;
    this.sweepChanged = true;
    const { payload, ms } = await this.link.commandBinary(cmd, 3 * pts + 2, { timeoutMs: 8000 + pts * 40, quiet });
    if (payload[0] !== 0x7b) throw new Error('scanraw frame did not start with "{"');
    const f = new Float64Array(pts), dbm = new Float32Array(pts);
    for (let i = 0; i < pts; i++) {
      const o = 1 + 3 * i;
      if (payload[o] !== 0x78) throw new Error(`scanraw frame lost sync at point ${i}`);
      dbm[i] = (payload[o + 1] | (payload[o + 2] << 8)) / 32 - this.scale;
      f[i] = start + (stop - start) * i / (pts - 1);
    }
    this.lastStatus = STATUS.OK;
    return { f, dbm, pts, start, stop, t: Date.now(), ms, cmd, method: 'scanraw' };
  }

  // ---- levels / gain (tsapython levels_gain.py) ------------------------------
  /** rbw auto|0.2..850 (kHz, model-dependent) */
  async rbw(v)        { return this._ok(`rbw ${v}`, 'rbw', { timeoutMs: 25000 }); }
  /** attenuate auto|0-31 */
  async attenuate(v)  { if (v !== 'auto' && !(v >= 0 && v <= 31)) this._blocked('attenuate', 'auto or 0..31'); return this._ok(`attenuate ${v}`, 'attenuate', { timeoutMs: 25000 }); }
  /** lna on|off (Ultra family) */
  async lna(on)       { this._need('lna'); return this._ok(`lna ${on ? 'on' : 'off'}`, 'lna', { timeoutMs: 25000 }); }
  /** spur off|on|auto (auto on the Ultra family only); true/false are accepted. */
  async spur(v)       { const w = v === true ? 'on' : v === false ? 'off' : String(v); this._word('spur', w, this.env.spurWords); return this._ok(`spur ${w}`, 'spur', { timeoutMs: 25000 }); }
  /** calc off|minh|maxh|maxd|aver4|aver16|aver|quasi|log|lin — the device's own trace math ('quasip' is the old spelling) */
  async calc(mode)    { if (mode === 'quasip') mode = 'quasi'; this._word('calc', mode, this.env.calcWords); return this._ok(`calc ${mode}`, 'calc', { timeoutMs: 25000 }); }
  /** ext_gain -100..100 (dB) */
  async extGain(db)   { return this._ok(`ext_gain ${db}`, 'ext_gain', { timeoutMs: 3000 }); }
  /** ultra on|off|auto — extended range on the Ultra family */
  async ultra(mode)   { this._need('ultra'); return this._ok(`ultra ${mode}`, 'ultra', { timeoutMs: 25000 }); }

  // ---- markers / traces on the device (markers_traces.py) ---------------------
  /** marker N on|off|peak|{freq}|{index}; N up to the model's count (4 Basic, 8 Ultra family). */
  async marker(n, v) { if (!(n >= 1 && n <= this.env.markers)) this._blocked('marker', `this model has ${this.env.markers} markers`); return this._ok(`marker ${n} ${v}`, `marker ${n}`, { timeoutMs: 25000 }); }
  async markerPeak(n) { return this.marker(n, 'peak'); }
  /**
   * Device markers, from a bare "marker". Each line is read as: first integer =
   * id, largest number ≥ 10 kHz = frequency, a number between −150 and +30 with
   * a decimal = level. Returns [{ id, f, dbm }].
   */
  async markersList() {
    const body = (await this._cmd('marker', { timeoutMs: 3000 })).body;
    const out = [];
    for (const line of body.split('\n')) {
      const nums = line.trim().split(/\s+/).map(Number).filter(Number.isFinite); if (nums.length < 2) continue;
      const id = nums[0], f = Math.max(...nums.slice(1)); if (!(id >= 1 && id <= 8) || f < 1e4) continue;
      const lvl = nums.slice(1).find(v => v > -150 && v < 30 && !Number.isInteger(v));
      out.push({ id, f, dbm: lvl ?? null });
    }
    return out;
  }
  /** Put the page's markers on the device by frequency. Returns { sent, skipped, error }. */
  async syncMarkers(markerFreqs) {
    const n = this.env.markers || 4;
    const result = { sent: 0, skipped: Math.max(0, markerFreqs.length - n), error: null };
    try {
      for (let k = 1; k <= n; k++) {
        const mf = markerFreqs[k - 1];
        if (mf == null) { await this.marker(k, 'off'); continue; }
        await this.marker(k, Math.round(mf)); result.sent++;
      }
    } catch (e) { result.error = e.message; }
    return result;
  }
  /** trace N value — read the device trace N as dBm per point. */
  async traceValue(n = 1) { const body = fixColon((await this._cmd(`trace ${n} value`)).body); return Float32Array.from(body.split('\n').map(l => parseFloat(l.trim().split(/\s+/).pop())).filter(Number.isFinite)); }

  // ---- signal generator (output_signal.py) ---------------------------------------
  /** The RF output gate. Sends nothing; output('on') and caloutput(<freq>) are refused until it is true. */
  setOutputAllowed(on) { this.outputAllowed = !!on; }
  _checkOutputAllowed(what) { if (!this.outputAllowed) this._blocked(what, 'RF output is not armed: confirm a load or attenuator is on the RF port first'); }
  /** mode low|high input|output — 'high' exists on the Basic only; the Ultra family has one band. */
  async mode(band, dir) {
    this._word('mode', band, this.env.modes); this._word('mode', dir, ['input', 'output']);
    return this._ok(`mode ${band} ${dir}`, 'mode', { timeoutMs: 25000 });
  }
  /** output on|off (|normal|mixer on the Ultra family). 'off' always goes; anything else needs the gate. */
  async output(v) {
    const w = v === true ? 'on' : v === false ? 'off' : String(v);
    this._word('output', w, this.env.outputWords);
    if (w !== 'off') this._checkOutputAllowed('output ' + w);
    return this._ok(`output ${w}`, 'output', { timeoutMs: 3000 });
  }
  /** Level range for a band, from the model: low −76..−6 everywhere; high −38..13 on the Basic only. */
  levelRange(band = 'low') { return band === 'high' ? this.env.levelHigh : this.env.levelLow; }
  /** level dBm, within the band's range. The firmware resets the level to maximum on every mode change, so set it after mode(). */
  async level(dbm, band = 'low') {
    const range = this.levelRange(band);
    if (!range) this._blocked('level', `the ${this.env.name} has no high output mode`);
    if (!(dbm >= range[0] && dbm <= range[1])) this._blocked('level', `${dbm} dBm is outside ${range[0]}..${range[1]} for ${band} output`);
    return this._ok(`level ${dbm}`, 'level', { timeoutMs: 25000 });
  }
  /**
   * modulation off|am|fm (Ultra family) or off|am|nfm|wfm|extern (Basic), as
   * current firmware spells them. The 2020 keywords AM_1kHz / AM_10Hz are
   * translated to am + a rate; NFM / WFM to lower case.
   */
  async modulation(m) {
    const legacy = { am_1khz: ['am', 1000], am_10hz: ['am', 10], nfm: ['nfm', null], wfm: ['wfm', null] }[String(m).toLowerCase()];
    let word = String(m).toLowerCase(), rate = null;
    if (legacy) [word, rate] = legacy;
    this._word('modulation', word, this.env.modulations);
    const r = await this._ok(`modulation ${word}`, 'modulation', { timeoutMs: 3000 });
    if (rate != null) await this.modulationFreq(rate);
    return r;
  }
  /** modulation freq {Hz} — AM/FM rate. */
  async modulationFreq(hz) { if (!(hz >= 1 && hz <= 10000)) this._blocked('modulation freq', '1..10000 Hz'); return this._ok(`modulation freq ${Math.round(hz)}`, 'modulation freq', { timeoutMs: 3000 }); }
  /** modulation depth {percent} — AM depth, Ultra family. */
  async modulationDepth(pct) { if (!this.env.modulations.includes('fm')) this._blocked('modulation depth', `not available on the ${this.env.name}`); if (!(pct >= 0 && pct <= 100)) this._blocked('modulation depth', '0..100 %'); return this._ok(`modulation depth ${Math.round(pct)}`, 'modulation depth', { timeoutMs: 3000 }); }
  /** modulation deviation {Hz} — FM deviation, Ultra family. */
  async modulationDeviation(hz) { if (!this.env.modulations.includes('fm')) this._blocked('modulation deviation', `not available on the ${this.env.name}`); if (!(hz >= 100 && hz <= 300000)) this._blocked('modulation deviation', '100..300000 Hz'); return this._ok(`modulation deviation ${Math.round(hz)}`, 'modulation deviation', { timeoutMs: 3000 }); }
  /** sweep cw {Hz} — the generator frequency (zero span). */
  async sweepCw(hz) { return this.sweep('cw', hz); }

  /**
   * Put the device into generator mode in the order the firmware needs and leave
   * the output OFF: output off → mode → output off → pause → level → sweep cw
   * → modulation [→ rate, depth/deviation] → resume. Stops at the first refused
   * step, resumes the sweep, and rethrows. tsapython setup_generator().
   */
  async setupGenerator({ freqHz, levelDbm, modulation = 'off', modulationRateHz = null, depthPct = null, deviationHz = null, band = 'low' }) {
    const steps = [
      () => this.output('off'), () => this.mode(band, 'output'), () => this.output('off'), () => this.pause(),
      () => this.level(levelDbm, band), () => this.sweepCw(freqHz), () => this.modulation(modulation),
    ];
    if (modulation !== 'off' && modulationRateHz != null) steps.push(() => this.modulationFreq(modulationRateHz));
    if (modulation === 'am' && depthPct != null) steps.push(() => this.modulationDepth(depthPct));
    if (modulation === 'fm' && deviationHz != null) steps.push(() => this.modulationDeviation(deviationHz));
    steps.push(() => this.resume());
    return this._runSteps(steps);
  }
  /** Change generator settings while already in output mode: pause → the given settings → resume. tsapython set_generator(). */
  async setGenerator({ freqHz, levelDbm, modulation, modulationRateHz, depthPct, deviationHz, band = 'low' } = {}) {
    const steps = [() => this.pause()];
    if (levelDbm != null) steps.push(() => this.level(levelDbm, band));
    if (freqHz != null) steps.push(() => this.sweepCw(freqHz));
    if (modulation != null) steps.push(() => this.modulation(modulation));
    if (modulationRateHz != null) steps.push(() => this.modulationFreq(modulationRateHz));
    if (depthPct != null) steps.push(() => this.modulationDepth(depthPct));
    if (deviationHz != null) steps.push(() => this.modulationDeviation(deviationHz));
    steps.push(() => this.resume());
    return this._runSteps(steps);
  }
  async _runSteps(steps) {
    for (const step of steps) {
      try { await step(); }
      catch (e) {
        const status = this.lastStatus;
        try { await this.resume(); } catch {}          // never leave the device paused
        this.lastStatus = status;
        throw e;
      }
    }
    return true;
  }

  // ---- calibration state (read-only on the page; calibration.py) -------------------
  /** freq_corr, actual_freq, zero, vbat_offset — whatever the firmware prints for each. freq_corr is Ultra-only. */
  async calState() {
    const out = {};
    for (const c of ['freq_corr', 'actual_freq', 'zero', 'vbat_offset']) {
      if (!this.has(c)) { out[c] = 'not on this model'; continue; }
      try { out[c] = (await this._cmd(c, { timeoutMs: 3000 })).body.trim(); } catch (e) { out[c] = 'error: ' + e.message; }
    }
    return out;
  }

  // ---- display / tools (display_ui.py) -----------------------------------------
  async touchCal()  { return this._cmd('touchcal', { timeoutMs: 60000 }); }
  async touchTest() { return this._cmd('touchtest', { timeoutMs: 60000 }); }
  /** caloutput off|30|15|10|4|3|2|1 — the built-in calibration signal (MHz). Anything but 'off' needs the output gate. */
  async calOutput(v) { if (String(v) !== 'off') this._checkOutputAllowed('caloutput ' + v); return this._ok(`caloutput ${v}`, 'caloutput', { timeoutMs: 3000 }); }

  // ---- screen -------------------------------------------------------------
  /** Grab the framebuffer. Returns { width, height, rgba, ms }. tsapython reads it as big-endian RGB565 (">H"). */
  async capture() {
    const [W, H] = this.env.screen;
    const { payload, ms } = await this.link.commandBinary('capture', W * H * 2);
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const v = (payload[2 * i] << 8) | payload[2 * i + 1];
      const r = (v >> 11) & 31, g = (v >> 5) & 63, b = v & 31;
      rgba[4 * i] = (r << 3) | (r >> 2); rgba[4 * i + 1] = (g << 2) | (g >> 4); rgba[4 * i + 2] = (b << 3) | (b >> 2); rgba[4 * i + 3] = 255;
    }
    return { width: W, height: H, rgba, ms };
  }

  // ---- raw -----------------------------------------------------------------
  /** Anything else, for the console box. The reply is classified (lastStatus) but not thrown; the console shows the device's text. */
  async raw(cmd, timeoutMs = 25000) { return this._cmd(cmd, { timeoutMs }); }
}
