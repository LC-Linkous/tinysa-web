// generator.js — the signal-generator (TX) side: sidebar controls, the state
// the page last sent, and the Generator pane renderer.
// Commands mirror tsapython/_commands/output_signal.py: mode, output, level,
// modulation, and sweep cw for the frequency.
// SPDX-License-Identifier: GPL-2.0-only
import { fmtHz, clamp, niceStep, fmtAxis } from '../sa.js';
import { cssVar } from '../plot/common.js';

export const MODULATIONS = ['off', 'AM_1kHz', 'AM_10Hz', 'NFM', 'WFM', 'extern'];

export function initGenerator(root, getSa, con) {
  const gen = { band: 'low', freq: 433.92e6, level: -20, modulation: 'off', on: false, inMode: false, status: '' };
  const freq = root.querySelector('#genFreq'), level = root.querySelector('#genLevel'), levelOut = root.querySelector('#genLevelOut'), mod = root.querySelector('#genMod'), band = root.querySelector('#genBand'), onBtn = root.querySelector('#genOnBtn'), status = root.querySelector('#genStatus');
  const controls = root.querySelectorAll('select, input, button');
  let onChange = null;
  const note = (t, err) => { status.textContent = t; status.className = 'hint' + (err ? ' err' : ''); gen.status = t; onChange?.(); };
  async function send(label, fn) {
    const sa = getSa(); if (!sa) { note('not connected'); return false; }
    controls.forEach(c => c.disabled = true);
    try { await fn(sa); note(`${label} sent.`); return true; }
    catch (e) { note(`${label}: ${e.message}`, true); con.err(e.message); return false; }
    finally { setEnabled(true); }
  }
  function refreshOn() { onBtn.textContent = gen.on ? 'Output ON — click to stop' : 'Output off — click to start'; onBtn.classList.toggle('running', gen.on); onBtn.setAttribute('aria-pressed', String(gen.on)); }

  freq.addEventListener('change', () => { gen.freq = parseFloat(freq.value) * 1e6; onChange?.(); if (gen.inMode) send(`sweep cw ${Math.round(gen.freq)}`, sa => sa.sweepCw(gen.freq)); });
  level.addEventListener('input', () => { levelOut.textContent = level.value; });
  level.addEventListener('change', () => { gen.level = parseFloat(level.value); onChange?.(); if (gen.inMode) send(`level ${gen.level}`, sa => sa.level(gen.level)); });
  mod.addEventListener('change', () => { gen.modulation = mod.value; onChange?.(); if (gen.inMode) send(`modulation ${gen.modulation}`, sa => sa.modulation(gen.modulation)); });
  band.addEventListener('change', () => { gen.band = band.value; onChange?.(); if (gen.inMode) send(`mode ${gen.band} output`, sa => sa.mode(gen.band, 'output')); });
  onBtn.addEventListener('click', async () => {
    if (!gen.inMode) { note('enter Generator mode first (top bar)', true); return; }
    const want = !gen.on;
    const ok = await send(`output ${want ? 'on' : 'off'}`, async sa => { if (want) { await sa.sweepCw(gen.freq); await sa.level(gen.level); await sa.modulation(gen.modulation); } await sa.output(want); });
    if (ok) { gen.on = want; refreshOn(); onChange?.(); }
  });

  /** Put the device in output mode (called when the page switches to Generator). */
  async function enter() {
    const ok = await send(`mode ${gen.band} output`, async sa => { await sa.mode(gen.band, 'output'); await sa.sweepCw(gen.freq); await sa.level(gen.level); await sa.modulation(gen.modulation); });
    gen.inMode = ok; gen.on = false; refreshOn(); onChange?.(); return ok;
  }
  /** Back to analyzer: output off, input mode. */
  async function leave() {
    if (!gen.inMode) return;
    await send('output off, mode input', async sa => { try { await sa.output(false); } catch {} await sa.mode(gen.band, 'input'); });
    gen.inMode = false; gen.on = false; refreshOn(); onChange?.();
  }
  function setEnabled(on) { controls.forEach(c => c.disabled = !on); }
  refreshOn(); setEnabled(false); levelOut.textContent = level.value;
  return { gen, enter, leave, setEnabled, set onChange(fn) { onChange = fn; } };
}

/**
 * The Generator pane: nominal output spectrum around the carrier, as
 * commanded. The tinySA cannot measure its own output, so this is a picture
 * of the settings, not a measurement — the pane says so.
 */
export function renderGenerator(ctx, W, H, gen) {
  const pad = { l: 58, r: 16, t: 92, b: 40 }, pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const half = { off: 10e3, AM_1kHz: 5e3, AM_10Hz: 200, NFM: 30e3, WFM: 250e3, extern: 30e3 }[gen.modulation] || 10e3;
  const f0 = gen.freq, fa = f0 - half, fb = f0 + half, y0 = -100, y1 = 20;
  const sx = f => pad.l + (f - fa) / (fb - fa) * pw, sy = v => pad.t + ph - (clamp(v, y0, y1) - y0) / (y1 - y0) * ph;
  ctx.font = '12px ' + cssVar('--font'); ctx.lineWidth = 1; ctx.strokeStyle = cssVar('--grid'); ctx.fillStyle = cssVar('--ink-2');
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let y = y0; y <= y1; y += 20) { const yy = sy(y); ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(pad.l + pw, yy); ctx.stroke(); ctx.fillText(y, pad.l - 8, yy); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; const fs = niceStep(fb - fa, 6);
  for (let f = Math.ceil(fa / fs) * fs; f <= fb; f += fs) { const x = sx(f); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke(); ctx.fillText((f === f0 ? '' : (f > f0 ? '+' : '−')) + fmtAxis(Math.abs(f - f0) || f0), x, pad.t + ph + 6); }
  ctx.strokeStyle = cssVar('--axis'); ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + ph); ctx.lineTo(pad.l + pw, pad.t + ph); ctx.stroke();
  // nominal spectrum: carrier + modulation components
  const comps = [[0, 0]];
  if (gen.modulation === 'AM_1kHz') comps.push([-1e3, -6], [1e3, -6]); else if (gen.modulation === 'AM_10Hz') comps.push([-10, -6], [10, -6]);
  else if (gen.modulation === 'NFM') for (let k = 1; k <= 4; k++) comps.push([-k * 5e3, -4 - 7 * k], [k * 5e3, -4 - 7 * k]);
  else if (gen.modulation === 'WFM') for (let k = 1; k <= 8; k++) comps.push([-k * 19e3, -1 - 2.2 * k], [k * 19e3, -1 - 2.2 * k]);
  const floor = -95, col = gen.on ? cssVar('--trace') : cssVar('--ink-3');
  ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
  const N = 400;
  for (let i = 0; i <= N; i++) {
    const f = fa + (fb - fa) * i / N; let p = Math.pow(10, floor / 10);
    if (gen.on) for (const [df, rel] of comps) { const d = (f - f0 - df) / (half / 60); p += Math.pow(10, (gen.level + rel) / 10) / (1 + d * d); }
    const x = sx(f), y = sy(10 * Math.log10(p)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
  // readout block: three columns across the width, status line beneath
  const narrow = W < 760, bigPx = narrow ? 20 : 26, colW = pw / 3;
  const big = (label, value, x) => { ctx.fillStyle = cssVar('--ink-2'); ctx.font = '12px ' + cssVar('--font'); ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(label, x, 8); ctx.fillStyle = cssVar('--ink'); ctx.font = `600 ${bigPx}px ` + cssVar('--mono'); ctx.fillText(value, x, 24); };
  big('Frequency', fmtHz(gen.freq, 4), pad.l); big('Level', `${gen.level.toFixed(1)} dBm`, pad.l + colW); big('Modulation', gen.modulation, pad.l + 2 * colW);
  ctx.fillStyle = gen.on ? cssVar('--warn') : cssVar('--ink-3'); ctx.font = '700 13px ' + cssVar('--font'); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(gen.on ? '● OUTPUT ON' : (gen.inMode ? 'output off' : 'not in generator mode'), pad.l, 58);
  ctx.fillStyle = cssVar('--ink-3'); ctx.font = '11px ' + cssVar('--font'); ctx.textAlign = 'right';
  ctx.fillText(narrow ? 'nominal, as commanded — not measured' : 'nominal output as commanded — the tinySA cannot measure its own output', W - pad.r, 60);
}
