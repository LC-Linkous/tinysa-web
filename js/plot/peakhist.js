// peakhist.js — peak level and peak frequency over successive sweeps.
// The third panel of tsapython's plotting_waterfall_realtime.py.
// SPDX-License-Identifier: GPL-2.0-only
import { clamp, niceStep, fmtAxis } from '../sa.js';
import { cssVar } from './common.js';

/** peaks: [{ t, f, dbm }] oldest first. range: [floorDbm, refDbm]. */
export function renderPeakHistory(ctx, W, H, peaks, range) {
  const pad = { l: 58, r: 96, t: 14, b: 40 }, pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  ctx.font = '12px ' + cssVar('--font'); ctx.lineWidth = 1;
  ctx.strokeStyle = cssVar('--axis'); ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + ph); ctx.lineTo(pad.l + pw, pad.t + ph); ctx.lineTo(pad.l + pw, pad.t); ctx.stroke();
  if (peaks.length < 2) { ctx.fillStyle = cssVar('--ink-3'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('Peak history fills in as sweeps arrive.', W / 2, H / 2); return; }
  const n = peaks.length, [y0, y1] = range;
  let fmin = Infinity, fmax = -Infinity; for (const p of peaks) { fmin = Math.min(fmin, p.f); fmax = Math.max(fmax, p.f); }
  if (fmax - fmin < 1) { fmin -= 0.5e6; fmax += 0.5e6; } else { const m = (fmax - fmin) * 0.08; fmin -= m; fmax += m; }
  const sx = i => pad.l + i / (n - 1) * pw;
  const syL = v => pad.t + ph - (clamp(v, y0, y1) - y0) / (y1 - y0) * ph;
  const syR = f => pad.t + ph - (f - fmin) / (fmax - fmin) * ph;
  // grids + left axis (dBm)
  ctx.strokeStyle = cssVar('--grid'); ctx.fillStyle = cssVar('--ink-2'); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const ys = niceStep(y1 - y0, 6);
  for (let y = Math.ceil(y0 / ys) * ys; y <= y1 + 1e-9; y += ys) { const yy = syL(y); ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(pad.l + pw, yy); ctx.stroke(); ctx.fillText(+y.toFixed(1), pad.l - 8, yy); }
  // right axis (frequency)
  ctx.textAlign = 'left'; const fs = niceStep(fmax - fmin, 5);
  for (let f = Math.ceil(fmin / fs) * fs; f <= fmax; f += fs) ctx.fillText(fmtAxis(f), pad.l + pw + 8, syR(f));
  // x axis: sweep index
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; const xs = Math.max(1, niceStep(n, Math.max(3, Math.floor(pw / 70))));
  for (let i = 0; i < n; i += xs) ctx.fillText(String(i), sx(i), pad.t + ph + 6);
  ctx.save(); ctx.translate(14, pad.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('Peak level (dBm)', 0, 0); ctx.restore();
  ctx.save(); ctx.translate(W - 12, pad.t + ph / 2); ctx.rotate(Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('Peak frequency', 0, 0); ctx.restore();
  // series
  const line = (get, col, dash) => { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash(dash); ctx.beginPath(); peaks.forEach((p, i) => { const x = sx(i), y = get(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.setLineDash([]); };
  line(p => syR(p.f), cssVar('--minhold'), [4, 3]);
  line(p => syL(p.dbm), cssVar('--trace'), []);
  const last = peaks[n - 1]; ctx.fillStyle = cssVar('--ink'); ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText(`now ${last.dbm.toFixed(1)} dBm @ ${fmtAxis(last.f)} · ${n} sweeps`, pad.l + pw - 6, pad.t + 16);
}
