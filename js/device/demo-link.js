// demo-link.js — a simulated tinySA Ultra console.
// SPDX-License-Identifier: GPL-2.0-only
//
// Produces the same byte stream a real device does (echo, body, a single bare
// "ch>" prompt, chunked delivery) so ShellLink's parser is exercised, not
// bypassed. Reply shapes are copied from tsapython's
// tests/fixtures/captured_responses.py (Ultra, fw tinySA4_v1.4-143).
// If a real device does something odd, teach this class to do it too.
import { ShellLink } from './shell-link.js';

const SCALE = 174;

export class DemoLink extends ShellLink {
  constructor() {
    super();
    this.sweepStart = 0; this.sweepStop = 2.6e9; this.sweepPts = 450;   // what the captured unit was on
    this.paused = false; this.rbw = 'auto'; this.atten = 'auto'; this.lnaOn = false; this.spurOn = false; this.calcMode = 'off'; this.extGain = 0;
    this.markers = {}; this.t0 = Date.now();
    this.mode = 'low input'; this.outputOn = false; this.genFreq = 433.92e6; this.genLevel = -20; this.modulation = 'off';
  }
  async open() {}
  info() { return 'demo'; }
  async close() { this.closed = true; }

  _send(bytes, delay, chunk = 512) {
    let i = 0;
    const step = () => { if (this.closed || i >= bytes.length) return; this._feed(bytes.slice(i, i + chunk)); i += chunk; setTimeout(step, 2); };
    setTimeout(step, delay);
  }
  _reply(cmd, body, delay) { this._send(this.enc.encode(cmd + '\r\n' + (body ? body + '\r\n' : '') + 'ch>'), delay); }

  /**
   * Simulated spectrum in dBm: a −90 dBm noise floor (worse at the top of the
   * band), FM broadcast, a 433 MHz ISM blip that comes and goes, a 2.4 GHz Wi-Fi
   * hump, and a spur near the LO. Peaks are Lorentzian in frequency.
   */
  level(f) {
    const t = (Date.now() - this.t0) / 1000;
    const peak = (fc, bw, p) => p - 10 * Math.log10(1 + Math.pow((f - fc) / (bw / 2), 2) * 3);
    let v = -92 + 4 * (f / 5.3e9);
    const parts = [
      peak(98.1e6, 200e3, -45), peak(101.7e6, 200e3, -52), peak(104.3e6, 200e3, -58),
      peak(433.92e6, 300e3, -40 + 25 * Math.max(0, Math.sin(t * 1.3))),   // keyed ISM transmitter
      peak(868.3e6, 600e3, -70),
      peak(2.437e9, 20e6, -62 + 4 * Math.sin(t * 0.7)), peak(2.462e9, 20e6, -66),
      peak(915e6, 2e6, -75),
    ];
    for (const p of parts) v = 10 * Math.log10(Math.pow(10, v / 10) + Math.pow(10, p / 10));
    // attenuation and LNA are corrected for on the device, so the reported level
    // stays the same; the noise floor moves instead.
    const floorShift = (this.atten === 'auto' ? 0 : +this.atten * 0.6) - (this.lnaOn ? 8 : 0);
    v = Math.max(v, -92 + floorShift + (Math.random() - 0.5) * 3);
    v += (Math.random() - 0.5) * 1.5;
    return v;
  }
  _fmtLevel(v) {
    // real firmware prints "%e" style and occasionally the ":.0" overflow glitch
    if (Math.random() < 0.002) return '-:.000000e+01';
    return v.toExponential(6).replace(/e([+-])(\d)$/, 'e$10$2');
  }

  _write(s) {
    const cmd = s.trim(); const [c, ...a] = cmd.split(/\s+/); const lc = (c || '').toLowerCase();
    let body = '', delay = 8;
    switch (lc) {
      case 'version': body = 'tinySA4_v1.4-143-g864bb27\nHW Version:V0.4.5.1.1 '; break;
      case 'info': body = 'tinySA ULTRA\n2019-2024 Copyright @Erik Kaashoek\n2016-2020 Copyright @edy555\nSW licensed under GPL. See: https://github.com/erikkaashoek/tinySA\nVersion: tinySA4_v1.4-143-g864bb27\nBuild Time: Jan 10 2024 - 11:14:08\nKernel: 4.0.0\nCompiler: GCC 7.2.1 20170904 (release) [ARM/embedded-7-branch revision 255204]\nArchitecture: ARMv7E-M Core Variant: Cortex-M4F\nPort Info: Advanced kernel mode\nPlatform: STM32F303xC Analog & DSP  (demo)'; break;
      case 'deviceid': body = a.length ? '' : 'deviceid 0'; break;
      case 'vbat': body = `${4100 + Math.round(Math.random() * 60)} mV`; break;
      case 'status': body = this.paused ? 'Paused' : 'Resumed'; break;
      case 'help': body = 'commands: version reset freq dac nf saveconfig clearconfig data frequencies scan scanraw hop sweep sweeptime trace trigger marker line capture refresh touch release vbat vbat_offset help info color if if1 lna lna2 agc actual_freq attenuate level sweep_voltage spur ultra correction calc caloutput output mode modulation rbw abort ext_gain pause resume save recall sd_list sd_read sd_delete touchcal touchtest usart_cfg deviceid selftest x text zero'; break;
      case 'pause': this.paused = true; break;
      case 'resume': this.paused = false; break;
      case 'rbw': if (!a.length) body = 'usage: rbw auto|3..600'; else this.rbw = a[0]; break;
      case 'attenuate': if (!a.length) body = 'usage: attenuate [auto|0-31]'; else this.atten = a[0]; break;
      case 'lna': if (!['on', 'off'].includes((a[0] || '').toLowerCase())) body = 'usage: lna off|on'; else this.lnaOn = a[0] === 'on'; break;
      case 'spur': if (!['on', 'off'].includes((a[0] || '').toLowerCase())) body = 'usage: spur on|off'; else this.spurOn = a[0] === 'on'; break;
      case 'calc': { const ok = ['off', 'minh', 'maxh', 'maxd', 'aver4', 'aver16', 'quasip']; if (!ok.includes((a[0] || '').toLowerCase())) body = 'usage: calc off|minh|maxh|maxd|aver4|aver16|quasip'; else this.calcMode = a[0]; break; }
      case 'ext_gain': if (!a.length || !Number.isFinite(+a[0])) body = 'usage: ext_gain -100..100'; else this.extGain = +a[0]; break;
      case 'ultra': break;
      case 'caloutput': break;
      case 'touchcal': body = 'touch calibration: tap the targets on the device screen (simulated)'; delay = 600; break;
      case 'touchtest': body = 'touch test running (simulated)'; delay = 600; break;
      case 'marker': {
        if (a.length >= 2) {
          const id = +a[0], v = a[1].toLowerCase();
          if (!(id >= 1 && id <= 4)) body = 'usage: marker {id} on|off|peak|{freq}|{index}';
          else if (v === 'off') delete this.markers[id];
          else if (v === 'peak') { let bf = 0, bv = -Infinity; for (let i = 0; i < this.sweepPts; i++) { const f = this.sweepStart + (this.sweepStop - this.sweepStart) * i / (this.sweepPts - 1), l = this.level(f); if (l > bv) { bv = l; bf = f; } } this.markers[id] = Math.round(bf); }
          else if (v === 'on') this.markers[id] = this.markers[id] || Math.round((this.sweepStart + this.sweepStop) / 2);
          else this.markers[id] = +v < this.sweepPts ? Math.round(this.sweepStart + (this.sweepStop - this.sweepStart) * (+v) / (this.sweepPts - 1)) : +v;
        }
        // listing: "id index frequency level" per enabled marker (format assumed; see PROTOCOL.md)
        else body = Object.entries(this.markers).map(([k, f]) => { const idx = Math.round((f - this.sweepStart) / (this.sweepStop - this.sweepStart) * (this.sweepPts - 1)); return `${k} ${idx} ${f} ${this.level(f).toFixed(2)}`; }).join('\n');
        break; }
      case 'mode': { const m = `${(a[0] || '').toLowerCase()} ${(a[1] || '').toLowerCase()}`; if (!/^(low|high) (input|output)$/.test(m)) body = 'usage: mode low|high input|output'; else { this.mode = m; if (m.endsWith('input')) this.outputOn = false; } delay = 150; break; }
      case 'output': if (!['on', 'off'].includes((a[0] || '').toLowerCase())) body = 'usage: output on|off'; else if (!this.mode.endsWith('output') && a[0] === 'on') body = 'output: not in output mode'; else this.outputOn = a[0].toLowerCase() === 'on'; break;
      case 'level': { const v = parseFloat(a[0]); if (!Number.isFinite(v) || v < -76 || v > 13) body = 'usage: level -76..13'; else this.genLevel = v; break; }
      case 'modulation': { const ok = ['off', 'am_1khz', 'am_10hz', 'nfm', 'wfm', 'extern']; if (!ok.includes((a[0] || '').toLowerCase())) body = 'usage: modulation off|AM_1kHz|AM_10Hz|NFM|WFM|extern'; else this.modulation = a[0]; break; }
      case 'freq_corr': body = '0 ppb'; break;
      case 'vbat_offset': body = a.length ? '' : '300'; break;
      case 'actual_freq': body = '30000000'; break;
      case 'zero': body = '174dBm'; break;
      case 'sweep': {
        const kw = (a[0] || '').toLowerCase();
        if (!a.length) body = `${this.sweepStart} ${this.sweepStop} ${this.sweepPts}`;
        else if (['start', 'stop', 'center', 'span', 'cw'].includes(kw)) {
          const v = +a[1]; const c0 = (this.sweepStart + this.sweepStop) / 2, sp = this.sweepStop - this.sweepStart;
          if (kw === 'start') this.sweepStart = v; else if (kw === 'stop') this.sweepStop = v;
          else if (kw === 'center') { this.sweepStart = v - sp / 2; this.sweepStop = v + sp / 2; }
          else if (kw === 'span') { this.sweepStart = c0 - v / 2; this.sweepStop = c0 + v / 2; }
          else { this.sweepStart = v; this.sweepStop = v; this.genFreq = v; }
        } else { this.sweepStart = +a[0]; this.sweepStop = +a[1]; if (a[2]) this.sweepPts = +a[2]; }
        break; }
      case 'frequencies': { const L = []; for (let i = 0; i < this.sweepPts; i++) L.push(Math.round(this.sweepStart + (this.sweepStop - this.sweepStart) * i / (this.sweepPts - 1))); body = L.join('\n'); break; }
      case 'data': { const L = []; for (let i = 0; i < this.sweepPts; i++) L.push(this._fmtLevel(this.level(this.sweepStart + (this.sweepStop - this.sweepStart) * i / (this.sweepPts - 1)))); body = L.join('\n'); break; }
      case 'trace': { if (a[1] === 'value') { const L = []; for (let i = 0; i < this.sweepPts; i++) L.push(`${i} ${this._fmtLevel(this.level(this.sweepStart + (this.sweepStop - this.sweepStart) * i / (this.sweepPts - 1)))}`); body = L.join('\n'); } break; }
      case 'scan': {
        const st = +a[0], sp = +a[1], pts = +(a[2] || this.sweepPts), mask = +(a[3] || 0);
        if (!(st < sp)) { body = 'usage: scan {start(Hz)} {stop(Hz)} [points] [outmask]'; break; }
        this.sweepStart = st; this.sweepStop = sp; this.sweepPts = pts;   // real firmware: scan replaces the device sweep
        const L = [];
        for (let i = 0; i < pts; i++) {
          const f = st + (sp - st) * i / (pts - 1); const p = [];
          if (mask & 1) p.push(Math.round(f));
          if (mask & 2) p.push(this._fmtLevel(this.level(f)), '0.000000000');
          if (mask & 4) p.push(this._fmtLevel(this.level(f) - 3), '0.000000000');
          if (p.length) L.push(p.join(' ') + ' ');
        }
        body = L.join('\n'); delay = 120 + pts * 2.5; break; }
      case 'scanraw': {
        const st = +a[0], sp = +a[1], pts = +(a[2] || this.sweepPts);
        if (!(st < sp)) { body = 'usage: scanraw {start(Hz)} {stop(Hz)} [points] [unbuffered]'; break; }
        this.sweepStart = st; this.sweepStop = sp; this.sweepPts = pts;
        const head = this.enc.encode(cmd + '\r\n'), tail = this.enc.encode('}ch>');
        const buf = new Uint8Array(1 + 3 * pts); buf[0] = 0x7b;
        for (let i = 0; i < pts; i++) { const v = Math.max(0, Math.min(65535, Math.round((this.level(st + (sp - st) * i / (pts - 1)) + SCALE) * 32))); buf[1 + 3 * i] = 0x78; buf[2 + 3 * i] = v & 255; buf[3 + 3 * i] = v >> 8; }
        const all = new Uint8Array(head.length + buf.length + tail.length); all.set(head); all.set(buf, head.length); all.set(tail, head.length + buf.length);
        this._send(all, 80 + pts * 1.5, 256); return Promise.resolve(); }
      case 'capture': {
        // synthetic 480x320 big-endian RGB565 frame: dark field with a yellow trace
        const W = 480, H = 320, buf = new Uint8Array(W * H * 2);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 2; const v0 = this.level(this.sweepStart + (this.sweepStop - this.sweepStart) * x / W);
          const ty = Math.round(H * 0.1 + ((-10 - v0) / 110) * H * 0.8), on = Math.abs(y - ty) < 2;
          const r = on ? 31 : 1, g = on ? 63 : (y >> 5), b = on ? 6 : 6;
          const v = (r << 11) | (g << 5) | b; buf[i] = v >> 8; buf[i + 1] = v & 255;
        }
        const head = this.enc.encode(cmd + '\r\n'), tail = this.enc.encode('ch>');
        const all = new Uint8Array(head.length + buf.length + tail.length); all.set(head); all.set(buf, head.length); all.set(tail, head.length + buf.length);
        this._send(all, 20, 8192); return Promise.resolve(); }
      default: body = `${c}?`; break;
    }
    this._reply(cmd, body, delay);
    return Promise.resolve();
  }
}
