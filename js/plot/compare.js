// compare.js — the Compare view: live trace against the held trace, and the
// difference (live − held) on a second axis. Frequencies are matched by index
// when the grids agree and by nearest frequency when they do not.
// SPDX-License-Identifier: GPL-2.0-only
import { fmtAxis, nearestIndex, niceStep } from '../sa.js';
import { cssVar } from './common.js';

export function renderCompare(ctx, W, H, sw, held, levelRange) {
  const pad = { l: 54, r: 54, t: 14, b: 32 }, pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const [y0, y1] = levelRange;
  const sx = f => pad.l + (f - sw.start) / (sw.stop - sw.start) * pw, sy = v => pad.t + ph - (Math.min(Math.max(v, y0), y1) - y0) / (y1 - y0) * ph;
  ctx.font = '11px ' + cssVar('--font'); ctx.lineWidth = 1; ctx.strokeStyle = cssVar('--grid'); ctx.fillStyle = cssVar('--ink-2');
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let y = Math.ceil(y0 / 10) * 10; y <= y1; y += 10) { const yy = sy(y); ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(pad.l + pw, yy); ctx.stroke(); ctx.fillText(y, pad.l - 6, yy); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; const fs = niceStep(sw.stop - sw.start, 6);
  for (let f = Math.ceil(sw.start / fs) * fs; f <= sw.stop; f += fs) { const x = sx(f); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke(); ctx.fillText(fmtAxis(f), x, pad.t + ph + 6); }
  const line = (arr, fArr, col, width, dash) => { ctx.strokeStyle = col; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.beginPath(); for (let i = 0; i < arr.length; i++) { const x = sx(fArr[i]), y = sy(arr[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); ctx.setLineDash([]); };
  if (!held) {
    line(sw.dbm, sw.f, cssVar('--trace'), 1.5);
    ctx.fillStyle = cssVar('--ink-3'); ctx.font = '12px ' + cssVar('--font'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('Press Hold to keep a trace; this view then shows live, held and the difference.', pad.l + pw / 2, pad.t + 24);
    return { pad, pw, sx, sy, fx: x => sw.start + (x - pad.l) / pw * (sw.stop - sw.start), yOf: i => sw.dbm[i] };
  }
  line(held.dbm, held.f, cssVar('--held'), 1.2, [4, 3]);
  line(sw.dbm, sw.f, cssVar('--trace'), 1.5);
  // the difference, on a right-hand axis ±delta
  const same = held.pts === sw.pts && held.start === sw.start && held.stop === sw.stop;
  const d = new Float32Array(sw.pts); let dmax = 1;
  for (let i = 0; i < sw.pts; i++) { const j = same ? i : nearestIndex(held.f, sw.f[i]); d[i] = sw.dbm[i] - held.dbm[j]; dmax = Math.max(dmax, Math.abs(d[i])); }
  const dr = Math.min(60, Math.ceil(dmax / 5) * 5), dy = v => pad.t + ph / 2 - v / dr * ph / 2;
  ctx.strokeStyle = cssVar('--ink-3'); ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(pad.l, dy(0)); ctx.lineTo(pad.l + pw, dy(0)); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = cssVar('--maxhold'); ctx.lineWidth = 1.2; ctx.beginPath(); for (let i = 0; i < sw.pts; i++) { const x = sx(sw.f[i]), y = dy(d[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
  ctx.fillStyle = cssVar('--maxhold'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '11px ' + cssVar('--font');
  for (const v of [dr, dr / 2, 0, -dr / 2, -dr]) ctx.fillText((v > 0 ? '+' : '') + v, pad.l + pw + 6, dy(v));
  ctx.fillStyle = cssVar('--ink-3'); ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText('Δ dB (live − held)', pad.l + pw, pad.t + 2);
  let sum = 0; for (let i = 0; i < sw.pts; i++) sum += d[i];
  ctx.textAlign = 'left'; ctx.fillText(`mean Δ ${(sum / sw.pts).toFixed(2)} dB · max |Δ| ${dmax.toFixed(1)} dB`, pad.l + 4, pad.t + 2);
  return { pad, pw, sx, sy, fx: x => sw.start + (x - pad.l) / pw * (sw.stop - sw.start), yOf: i => sw.dbm[i] };
}
