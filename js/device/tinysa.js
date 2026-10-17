// tinysa.js — the tinySA API. Method names mirror the tsapython library.
// SPDX-License-Identifier: GPL-2.0-only
//
// This is the layer another tool would reuse. Callers never see "ch>" — they
// get strings and typed arrays. One ShellLink (serial or demo) underneath.
//
// A sweep is { pts, start, stop, f: Float64Array, dbm: Float32Array, t, ms, cmd, method }.
import { MODELS, DEFAULT_MODEL, detectModel } from './models.js';
import { PROMPT } from './shell-link.js';

/** The console never signals errors; it prints a usage line or a complaint and then the prompt. */
export function looksLikeError(body) {
  const t = (body || '').trim().toLowerCase();
  return /^usage:|^\S+\?$|invalid|unknown|error|out of range|bad /.test(t);
}
function check(r, what) { if (looksLikeError(r.body)) { const e = new Error(`${what}: device replied "${r.body.trim().split('\n')[0]}"`); e.reply = r.body; throw e; } return r; }

/**
 * Some Jan-2024 firmware builds print a level as "-:.000000e+01": the firmware
 * overflows a single digit slot, so what should read "10" renders as ":".
 * tsapython's examples replace the colon form with 10 (negative first). Same here.
 */
export const fixColon = s => s.replace(/-:\.0/g, '-10.0').replace(/:\.0/g, '10.0');

export class TinySA {
  constructor(link) {
    this.link = link;
    this.model = DEFAULT_MODEL;
    this.ident = { version: '', info: '', modelName: '', label: '', hw: '' };
    this.deviceSweep = null; this.paused = false; this.sweepChanged = false; this.wedged = false;
  }
  get env() { return MODELS[this.model]; }
  /** scanraw scale factor: by model unless overridden. */
  get scale() { return this.scaleOverride ?? this.env.scale; }

  // ---- identity / system -------------------------------------------------
  async version()  { return (await this.link.command('version',  { timeoutMs: 3000 })).body.trim(); }
  async info()     { return (await this.link.command('info',     { timeoutMs: 3000 })).body.trim(); }
  async deviceId() { return (await this.link.command('deviceid', { timeoutMs: 3000 })).body.trim(); }
  async vbat()     { return (await this.link.command('vbat',     { timeoutMs: 3000 })).body.trim(); }   // "4154 mV"
  async status()   { return (await this.link.command('status',   { timeoutMs: 3000 })).body.trim(); }   // "Resumed" | "Paused"
  async help()     { return (await this.link.command('help',     { timeoutMs: 4000, quiet: true })).body; }

  /** version + info; throws if the port doesn't answer like a tinySA console. */
  async identify(modelOverride) {
    const v = await this.link.command('version', { timeoutMs: 3000 });
    const i = await this.link.command('info', { timeoutMs: 3000 });
    if (!v.raw.includes(PROMPT)) throw new Error('that port did not answer like a tinySA console');
    this.ident = { version: v.body.trim(), info: i.body.trim() };
    this.model = modelOverride && MODELS[modelOverride] ? modelOverride : detectModel(this.ident.version, this.ident.info);
    // version on an Ultra: "tinySA4_v1.4-143-g864bb27\nHW Version:V0.4.5.1.1"; info's first line is the product name.
    const hw = /HW Version:\s*(\S+)/i.exec(this.ident.version);
    this.ident.hw = hw ? hw[1] : '';
    this.ident.modelName = (this.ident.info.split('\n')[0] || '').trim() || this.ident.version.split('\n')[0];
    this.ident.firmware = this.ident.version.split('\n')[0].trim();
    this.ident.label = `${this.ident.modelName} · ${this.ident.firmware}${this.ident.hw ? ' · HW ' + this.ident.hw : ''}`;
    try { this.ident.help = await this.help(); } catch {}
    try { this.deviceSweep = await this.sweep(); } catch { this.deviceSweep = null; }
    return this.ident;
  }
  /** Put the device back on the sweep it had when we connected. */
  async restoreDeviceSweep() { const d = this.deviceSweep; if (this.sweepChanged && d && Number.isFinite(d.start) && Number.isFinite(d.stop)) { await this.sweep(d.start, d.stop, d.pts); this.sweepChanged = false; } }

  // ---- sweep control -----------------------------------------------------
  async pause()  { const r = await this.link.command('pause',  { timeoutMs: 2000 }); this.paused = true; return r; }
  async resume() { const r = await this.link.command('resume', { timeoutMs: 2000 }); this.paused = false; return r; }
  /**
   * sweep() -> {start, stop, pts}; sweep(a, b, n) sets; sweep('center', hz) etc.
   * tsapython: config_sweep / run_sweep. The reply to a bare "sweep" is
   * "start stop points" on current firmware.
   */
  async sweep(a, b, pts) {
    if (a == null) { const n = (await this.link.command('sweep')).body.trim().split(/\s+/).map(Number); return { start: n[0], stop: n[1], pts: n[2] }; }
    this.sweepChanged = true;
    if (typeof a === 'string') return check(await this.link.command(`sweep ${a} ${Math.round(b)}`), `sweep ${a}`);
    return check(await this.link.command(`sweep ${Math.round(a)} ${Math.round(b)}${pts ? ' ' + pts : ''}`), 'sweep');
  }
  async sweepTime(v) { return check(await this.link.command(`sweeptime ${v}`, { timeoutMs: 3000 }), 'sweeptime'); }
  async frequencies() { return (await this.link.command('frequencies')).body.split('\n').map(Number).filter(Number.isFinite); }

  // ---- acquisition -------------------------------------------------------
  /** data(0|1|2): the device's current trace in dBm (0 temp, 1 stored, 2 measurement). */
  async data(ch = 0) {
    const body = fixColon((await this.link.command(`data ${ch}`)).body);
    return Float32Array.from(body.split('\n').map(l => parseFloat(l)).filter(Number.isFinite));
  }

  _clip(start, stop, pts) {
    const m = this.env;
    start = Math.round(Math.min(Math.max(start, 0), m.maxHz));
    stop = Math.round(Math.min(Math.max(stop, 0), m.maxHz));
    if (!(start < stop)) stop = Math.min(m.maxHz, start + 1e6);
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
      const r = await this.link.command(cmd, { timeoutMs: 8000 + pts * 40, quiet });
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
   * dBm = value / 32 − scale (174 Ultra, 128 Basic). unbuf 1 = one frame per
   * call (tsapython: the device never streams more than one frame over USB).
   * Frequencies are reconstructed with linspace, as the library's examples do.
   */
  async scanRaw(start, stop, pts, { unbuf = 1, quiet = false } = {}) {
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
    return { f, dbm, pts, start, stop, t: Date.now(), ms, cmd, method: 'scanraw' };
  }

  // ---- levels / gain (tsapython levels_gain.py) ------------------------------
  /** rbw auto|3..600 (kHz) */
  async rbw(v)        { return check(await this.link.command(`rbw ${v}`, { timeoutMs: 3000 }), 'rbw'); }
  /** attenuate auto|0-31 */
  async attenuate(v)  { return check(await this.link.command(`attenuate ${v}`, { timeoutMs: 3000 }), 'attenuate'); }
  /** lna on|off (Ultra) */
  async lna(on)       { return check(await this.link.command(`lna ${on ? 'on' : 'off'}`, { timeoutMs: 3000 }), 'lna'); }
  /** spur on|off */
  async spur(on)      { return check(await this.link.command(`spur ${on ? 'on' : 'off'}`, { timeoutMs: 3000 }), 'spur'); }
  /** calc off|minh|maxh|maxd|aver4|aver16|quasip — the device's own trace math */
  async calc(mode)    { return check(await this.link.command(`calc ${mode}`, { timeoutMs: 3000 }), 'calc'); }
  /** ext_gain -100..100 (dB) */
  async extGain(db)   { return check(await this.link.command(`ext_gain ${db}`, { timeoutMs: 3000 }), 'ext_gain'); }
  /** ultra on|off|auto — extended range on the Ultra */
  async ultra(mode)   { return check(await this.link.command(`ultra ${mode}`, { timeoutMs: 3000 }), 'ultra'); }

  // ---- markers / traces on the device (markers_traces.py) ---------------------
  /** marker N on|off|peak|{freq}|{index} — the tinySA accepts a frequency directly. */
  async marker(n, v) { return check(await this.link.command(`marker ${n} ${v}`, { timeoutMs: 3000 }), `marker ${n}`); }
  async markerPeak(n) { return this.marker(n, 'peak'); }
  /**
   * Device markers, from a bare "marker". Reply format is firmware-dependent
   * (unverified); each line is read as: first integer = id, largest number
   * ≥ 10 kHz = frequency, a number between −150 and +30 with a decimal = level.
   * Returns [{ id, f, dbm }].
   */
  async markersList() {
    const body = (await this.link.command('marker', { timeoutMs: 3000 })).body;
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
  async traceValue(n = 1) { const body = fixColon((await this.link.command(`trace ${n} value`)).body); return Float32Array.from(body.split('\n').map(l => parseFloat(l.trim().split(/\s+/).pop())).filter(Number.isFinite)); }

  // ---- signal generator (output_signal.py) ---------------------------------------
  /** mode low|high input|output — switches the device between analyzer and generator. */
  async mode(band, dir) { return check(await this.link.command(`mode ${band} ${dir}`, { timeoutMs: 3000 }), 'mode'); }
  /** output on|off */
  async output(on) { return check(await this.link.command(`output ${on ? 'on' : 'off'}`, { timeoutMs: 3000 }), 'output'); }
  /** level −76..13 dBm (generator output level) */
  async level(dbm) { return check(await this.link.command(`level ${dbm}`, { timeoutMs: 3000 }), 'level'); }
  /** modulation off|AM_1kHz|AM_10Hz|NFM|WFM|extern */
  async modulation(m) { return check(await this.link.command(`modulation ${m}`, { timeoutMs: 3000 }), 'modulation'); }
  /** sweep cw {Hz} — the generator frequency (zero span). */
  async sweepCw(hz) { return this.sweep('cw', hz); }

  // ---- calibration state (read-only on the page; calibration.py) -------------------
  /** freq_corr, actual_freq, zero, vbat_offset — whatever the firmware prints for each. */
  async calState() {
    const out = {};
    for (const c of ['freq_corr', 'actual_freq', 'zero', 'vbat_offset']) { try { out[c] = (await this.link.command(c, { timeoutMs: 3000 })).body.trim(); } catch (e) { out[c] = 'error: ' + e.message; } }
    return out;
  }

  // ---- display / tools (display_ui.py) -----------------------------------------
  async touchCal()  { return this.link.command('touchcal', { timeoutMs: 60000 }); }
  async touchTest() { return this.link.command('touchtest', { timeoutMs: 60000 }); }
  /** caloutput off|30|15|10|4|3|2|1 — the built-in calibration signal (MHz). */
  async calOutput(v) { return check(await this.link.command(`caloutput ${v}`, { timeoutMs: 3000 }), 'caloutput'); }

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
  /** Anything else, for the console box. */
  async raw(cmd, timeoutMs = 8000) { return this.link.command(cmd, { timeoutMs }); }
}
