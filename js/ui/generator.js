// generator.js — the signal-generator (TX) side: sidebar controls, the state
// the page last sent, and the Generator pane renderer.
// Commands mirror tsapython/_commands/output_signal.py (4.0.0): setupGenerator()
// to enter output mode, setGenerator() for changes (both pause the sweep
// around the settings), output on|off behind the RF-output arming checkbox.
// SPDX-License-Identifier: GPL-2.0-only
import { fmtHz, clamp, niceStep, fmtAxis } from '../sa.js';
import { cssVar } from '../plot/common.js';

/** Modulation words by family, as current firmware spells them (the 2020 AM_1kHz / AM_10Hz keywords are gone). */
export const MODULATIONS = { ultra: ['off', 'am', 'fm'], basic: ['off', 'am', 'nfm', 'wfm', 'extern'] };
const MOD_LABELS = { off: 'off (CW)', am: 'AM', fm: 'FM', nfm: 'NFM (narrow FM)', wfm: 'WFM (wide FM)', extern: 'external' };

export function initGenerator(root, getSa, con) {
  const gen = { band: 'low', freq: 433.92e6, level: -20, modulation: 'off', rate: 1000, depth: 50, deviation: 3000, on: false, armed: false, inMode: false, status: '' };
  const $ = id => root.querySelector('#' + id);
  const freq = $('genFreq'), level = $('genLevel'), levelOut = $('genLevelOut'), levelRange = $('genLevelRange'), mod = $('genMod'), band = $('genBand'), bandField = $('genBandField'),
    rate = $('genRate'), rateField = $('genRateField'), depth = $('genDepth'), depthField = $('genDepthField'), dev = $('genDev'), devField = $('genDevField'),
    arm = $('genArm'), onBtn = $('genOnBtn'), status = $('genStatus');
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
  function refreshOn() {
    onBtn.textContent = gen.on ? 'Output ON — click to stop' : 'Output off — click to start';
    onBtn.classList.toggle('running', gen.on); onBtn.setAttribute('aria-pressed', String(gen.on));
    onBtn.disabled = !gen.inMode || !gen.armed;
  }
  /** Rebuild the model-dependent controls: band (Basic only), modulation words, level range. */
  function fitModel(sa) {
    const env = sa?.env; const family = env?.family === 'basic' ? 'basic' : 'ultra';
    bandField.hidden = !(env?.modes || []).includes('high');
    if (bandField.hidden) gen.band = 'low';
    const words = MODULATIONS[family];
    mod.innerHTML = words.map(w => `<option value="${w}">${MOD_LABELS[w]}</option>`).join('');
    if (!words.includes(gen.modulation)) gen.modulation = 'off';
    mod.value = gen.modulation;
    const range = sa ? sa.levelRange(gen.band) : [-76, -6];
    level.min = range[0]; level.max = range[1]; gen.level = clamp(gen.level, range[0], range[1]); level.value = gen.level; levelOut.textContent = gen.level;
    levelRange.textContent = `${range[0]} … ${range[1]} dBm (${gen.band} output, ${env?.name || 'tinySA'})`;
    fitModulation();
  }
  function fitModulation() {
    const m = gen.modulation; const ultra = MODULATIONS.ultra.includes(m) && !['nfm', 'wfm', 'extern'].includes(m);
    rateField.hidden = m === 'off' || m === 'extern';
    depthField.hidden = !(m === 'am' && ultra);
    devField.hidden = !(m === 'fm');
  }
  /** The settings the device should have, for setupGenerator()/setGenerator(). */
  const settings = () => ({ band: gen.band, freqHz: gen.freq, levelDbm: gen.level, modulation: gen.modulation,
    modulationRateHz: gen.modulation === 'off' || gen.modulation === 'extern' ? null : gen.rate,
    depthPct: gen.modulation === 'am' && getSa()?.env.family !== 'basic' ? gen.depth : null,
    deviationHz: gen.modulation === 'fm' ? gen.deviation : null });

  freq.addEventListener('change', () => { gen.freq = parseFloat(freq.value) * 1e6; onChange?.(); if (gen.inMode) send(`sweep cw ${Math.round(gen.freq)}`, sa => sa.setGenerator({ freqHz: gen.freq })); });
  level.addEventListener('input', () => { levelOut.textContent = level.value; });
  level.addEventListener('change', () => { gen.level = parseFloat(level.value); onChange?.(); if (gen.inMode) send(`level ${gen.level}`, sa => sa.setGenerator({ levelDbm: gen.level, band: gen.band })); });
  mod.addEventListener('change', () => { gen.modulation = mod.value; fitModulation(); onChange?.(); if (gen.inMode) { const s = settings(); send(`modulation ${gen.modulation}`, sa => sa.setGenerator({ modulation: s.modulation, modulationRateHz: s.modulationRateHz, depthPct: s.depthPct, deviationHz: s.deviationHz })); } });
  rate.addEventListener('change', () => { gen.rate = parseFloat(rate.value); onChange?.(); if (gen.inMode) send(`modulation freq ${gen.rate}`, sa => sa.setGenerator({ modulationRateHz: gen.rate })); });
  depth.addEventListener('change', () => { gen.depth = parseFloat(depth.value); onChange?.(); if (gen.inMode) send(`modulation depth ${gen.depth}`, sa => sa.setGenerator({ depthPct: gen.depth })); });
  dev.addEventListener('change', () => { gen.deviation = parseFloat(dev.value); onChange?.(); if (gen.inMode) send(`modulation deviation ${gen.deviation}`, sa => sa.setGenerator({ deviationHz: gen.deviation })); });
  band.addEventListener('change', () => { gen.band = band.value; fitModel(getSa()); onChange?.(); if (gen.inMode) { gen.on = false; refreshOn(); send(`mode ${gen.band} output`, sa => sa.setupGenerator(settings())); } });
  arm.addEventListener('change', () => { gen.armed = arm.checked; getSa()?.setOutputAllowed(gen.armed); refreshOn(); note(gen.armed ? 'RF output armed: the big button will switch it on.' : 'RF output disarmed.'); });
  onBtn.addEventListener('click', async () => {
    if (!gen.inMode) { note('enter Generator mode first (top bar)', true); return; }
    if (!gen.armed) { note('tick the arming box first: a load or attenuator must be on the RF port', true); return; }
    const want = !gen.on;
    const ok = await send(`output ${want ? 'on' : 'off'}`, async sa => { await sa.output(want); });
    if (ok) { gen.on = want; refreshOn(); onChange?.(); }
  });

  /** Put the device in output mode (called when the page switches to Generator): the firmware's order, output left off. */
  async function enter() {
    const sa = getSa(); fitModel(sa); if (sa) sa.setOutputAllowed(gen.armed);
    const ok = await send(`mode ${gen.band} output`, sa => sa.setupGenerator(settings()));
    gen.inMode = ok; gen.on = false; refreshOn(); onChange?.(); return ok;
  }
  /** Back to analyzer: output off, input mode (the firmware also mutes on a mode change). */
  async function leave() {
    if (!gen.inMode) return;
    await send('output off, mode input', async sa => { try { await sa.output(false); } catch {} await sa.pause(); await sa.mode(gen.band, 'input'); await sa.resume(); });
    gen.inMode = false; gen.on = false; refreshOn(); onChange?.();
  }
  function setEnabled(on) { controls.forEach(c => c.disabled = !on); refreshOn(); }
  fitModel(null); refreshOn(); setEnabled(false); levelOut.textContent = level.value;
  return { gen, enter, leave, setEnabled, fitModel, set onChange(fn) { onChange = fn; } };
}

/**
 * The Generator pane: nominal output spectrum around the carrier, as
 * commanded. The tinySA cannot measure its own output, so this is a picture
 * of the settings, not a measurement — the pane says so.
 */
export function renderGenerator(ctx, W, H, gen) {
  const pad = { l: 58, r: 16, t: 92, b: 40 }, pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const m = gen.modulation, rate = gen.rate || 1000, devn = gen.deviation || 3000;
  const half = { off: 10e3, am: Math.max(5 * rate, 2e3), fm: Math.max(2 * (devn + rate), 5e3), nfm: 30e3, wfm: 250e3, extern: 30e3 }[m] || 10e3;
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
  if (m === 'am') { const side = -6 - 20 * Math.log10(100 / Math.max(gen.depth || 50, 1)); comps.push([-rate, side], [rate, side]); }
  else if (m === 'fm') { const n = Math.min(8, Math.ceil(devn / rate) + 1); for (let k = 1; k <= n; k++) comps.push([-k * rate, -2 - 3 * k], [k * rate, -2 - 3 * k]); }
  else if (m === 'nfm') for (let k = 1; k <= 4; k++) comps.push([-k * 5e3, -4 - 7 * k], [k * 5e3, -4 - 7 * k]);
  else if (m === 'wfm') for (let k = 1; k <= 8; k++) comps.push([-k * 19e3, -1 - 2.2 * k], [k * 19e3, -1 - 2.2 * k]);
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
  const modText = m === 'off' ? 'off' : m === 'am' ? `AM ${rate} Hz${gen.depth ? ' ' + gen.depth + '%' : ''}` : m === 'fm' ? `FM ${rate} Hz ±${fmtAxis(devn)}` : m.toUpperCase();
  big('Frequency', fmtHz(gen.freq, 4), pad.l); big('Level', `${gen.level.toFixed(1)} dBm`, pad.l + colW); big('Modulation', modText, pad.l + 2 * colW);
  ctx.fillStyle = gen.on ? cssVar('--warn') : cssVar('--ink-3'); ctx.font = '700 13px ' + cssVar('--font'); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(gen.on ? '● OUTPUT ON' : (gen.inMode ? (gen.armed ? 'output off' : 'output off — not armed') : 'not in generator mode'), pad.l, 58);
  ctx.fillStyle = cssVar('--ink-3'); ctx.font = '11px ' + cssVar('--font'); ctx.textAlign = 'right';
  ctx.fillText(narrow ? 'nominal, as commanded — not measured' : 'nominal output as commanded — the tinySA cannot measure its own output', W - pad.r, 60);
}
