// sa.js — pure spectrum-analyzer math and formatting. No DOM, no state.
// SPDX-License-Identifier: GPL-2.0-only

export const clamp = (v, a, b) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));

export function fmtHz(f, digits = 3) {
  if (!Number.isFinite(f)) return '—';
  if (f >= 1e9) return (f / 1e9).toFixed(digits) + ' GHz';
  if (f >= 1e6) return (f / 1e6).toFixed(digits) + ' MHz';
  if (f >= 1e3) return (f / 1e3).toFixed(1) + ' kHz';
  return f.toFixed(0) + ' Hz';
}
/** Short axis label: drop trailing zeros ("1.5 GHz", "200 MHz"). */
export const fmtAxis = f => fmtHz(f).replace(/\.?0+ (\w)/, ' $1');
export const fmtDbm = v => (Number.isFinite(v) ? v.toFixed(1) : '—') + ' dBm';

export function nearestIndex(freqs, fHz) {
  let b = 0, bd = Infinity;
  for (let i = 0; i < freqs.length; i++) { const d = Math.abs(freqs[i] - fHz); if (d < bd) { bd = d; b = i; } }
  return b;
}
export function niceStep(range, target) {
  const raw = range / target, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/** Index of the highest level. */
export function peakIndex(dbm) { let b = 0, bv = -Infinity; for (let i = 0; i < dbm.length; i++) if (dbm[i] > bv) { bv = dbm[i]; b = i; } return b; }

/**
 * Local maxima, highest first, at least minSep points apart and at least
 * minAbove dB over the sweep's median (a cheap noise-floor estimate).
 */
export function findPeaks(dbm, { count = 4, minSep = 5, minAbove = 10 } = {}) {
  const n = dbm.length; if (n < 3) return [];
  const sorted = Float32Array.from(dbm).sort(); const floor = sorted[n >> 1];
  const cand = [];
  for (let i = 1; i < n - 1; i++) if (dbm[i] >= dbm[i - 1] && dbm[i] > dbm[i + 1] && dbm[i] - floor >= minAbove) cand.push(i);
  cand.sort((a, b) => dbm[b] - dbm[a]);
  const out = [];
  for (const i of cand) { if (out.every(j => Math.abs(j - i) >= minSep)) out.push(i); if (out.length >= count) break; }
  return out;
}

/** Channel power over [i0, i1]: sum of mW per point (no bandwidth normalisation). */
export function channelPowerDbm(dbm, i0, i1) {
  let mw = 0; for (let i = i0; i <= i1; i++) mw += Math.pow(10, dbm[i] / 10);
  return 10 * Math.log10(mw);
}

/** Running combine helpers for page-side max/min hold and averaging. */
export const holdMax = (acc, cur) => { for (let i = 0; i < cur.length; i++) if (cur[i] > acc[i]) acc[i] = cur[i]; return acc; };
export const holdMin = (acc, cur) => { for (let i = 0; i < cur.length; i++) if (cur[i] < acc[i]) acc[i] = cur[i]; return acc; };
/** Exponential average in the power domain, alpha = 1/N. */
export const averageInto = (acc, cur, n) => { const a = 1 / n; for (let i = 0; i < cur.length; i++) { const p = Math.pow(10, acc[i] / 10) * (1 - a) + Math.pow(10, cur[i] / 10) * a; acc[i] = 10 * Math.log10(p); } return acc; };
