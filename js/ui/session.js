// session.js — save/load the page state as JSON; load a CSV as an overlay.
// SPDX-License-Identifier: GPL-2.0-only

const pack = sw => sw && { pts: sw.pts, start: sw.start, stop: sw.stop, t: sw.t, ms: sw.ms, method: sw.method, f: Array.from(sw.f), dbm: Array.from(sw.dbm) };
const unpack = o => o && { ...o, f: Float64Array.from(o.f), dbm: Float32Array.from(o.dbm) };

export function sessionBlob({ sweep, held, overlay, markers, settings, model, ident, appVersion }) {
  const data = { tool: 'tinysa-web', version: appVersion, when: new Date().toISOString(), model, ident, markers, settings, sweep: pack(sweep), held: pack(held), overlay: overlay && { name: overlay.name, sweep: pack(overlay.sweep) } };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}
export function parseSession(text) {
  const d = JSON.parse(text);
  if (d.tool !== 'tinysa-web') throw new Error('not a tinySA Web session file');
  return { ...d, sweep: unpack(d.sweep), held: unpack(d.held), overlay: d.overlay && { name: d.overlay.name, sweep: unpack(d.overlay.sweep) } };
}

/**
 * Two-column CSV reader: frequency (Hz) and level (dBm), header optional.
 * Reads the page's own export, tsapython's save_scan_csv.py output, and one
 * row of a waterfall matrix is not supported (use the sweep log instead).
 */
export function parseCsv(text, name = 'overlay') {
  const f = [], dbm = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const v = line.split(/[,;\t ]+/); if (v.length < 2) continue;
    const a = Number(v[0]), b = Number(v[1]); if (!Number.isFinite(a) || !Number.isFinite(b)) continue;   // skips the header
    f.push(a); dbm.push(b);
  }
  if (f.length < 2) throw new Error('no frequency,level rows found');
  return { name, sweep: { pts: f.length, start: f[0], stop: f[f.length - 1], t: Date.now(), ms: 0, method: 'csv', f: Float64Array.from(f), dbm: Float32Array.from(dbm) } };
}

export function pickFile(accept) {
  return new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => res(i.files[0] || null); i.click(); });
}
