// meter.js — the zero-span level meter: one frequency, read continuously.
// A window view whose content is a panel, like nanovna-web's CW meter. Each
// reading is a small scanraw around the frequency (TinySA.measureAt), so the
// device's own screen freezes while the meter runs and is resumed on stop.
// SPDX-License-Identifier: GPL-2.0-only
import { fmtHz } from '../sa.js';
import { cssVar } from '../plot/common.js';

const HISTORY = 240;

export function initMeter(panel, getSa, con, { onStart, onStop, onReading } = {}) {
  const $ = id => panel.querySelector('#' + id);
  const freq = $('meterFreq'), span = $('meterSpan'), run = $('meterRun'), rate = $('meterRate'), peakEl = $('meterPeak'), meanEl = $('meterMean'), maxEl = $('meterMax'), minEl = $('meterMin'), fEl = $('meterF'), canvas = $('meterHist');
  const st = { on: false, history: [], max: -Infinity, min: Infinity, n: 0, t0: 0 };
  const fmt = v => Number.isFinite(v) ? v.toFixed(1) : '—';
  function draw() {
    const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight; if (!W || !H) return;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const h = st.history; if (h.length < 2) return;
    let lo = Math.min(...h) - 3, hi = Math.max(...h) + 3; if (hi - lo < 10) { const m = (hi + lo) / 2; lo = m - 5; hi = m + 5; }
    ctx.strokeStyle = cssVar('--grid'); ctx.lineWidth = 1; for (let k = 0; k <= 4; k++) { const y = H * k / 4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.strokeStyle = cssVar('--trace'); ctx.lineWidth = 1.5; ctx.beginPath();
    h.forEach((v, i) => { const x = W * i / (HISTORY - 1), y = H - (v - lo) / (hi - lo) * H; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.fillStyle = cssVar('--ink-3'); ctx.font = '10px ' + cssVar('--mono'); ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(hi.toFixed(0), 2, 2); ctx.textBaseline = 'bottom'; ctx.fillText(lo.toFixed(0), 2, H - 2);
  }
  function reset() { st.history = []; st.max = -Infinity; st.min = Infinity; st.n = 0; st.t0 = Date.now(); maxEl.textContent = minEl.textContent = '—'; draw(); }
  async function loop() {
    const sa = getSa();
    while (st.on && sa && getSa() === sa) {
      try {
        const hz = parseFloat(freq.value) * 1e6, spanHz = parseFloat(span.value) * 1e3;
        const m = await sa.measureAt(hz, { spanHz });
        st.n++; st.history.push(m.peak); if (st.history.length > HISTORY) st.history.shift();
        if (m.peak > st.max) st.max = m.peak; if (m.peak < st.min) st.min = m.peak;
        fEl.textContent = fmtHz(hz, 5); peakEl.textContent = fmt(m.peak); meanEl.textContent = fmt(m.mean); maxEl.textContent = fmt(st.max); minEl.textContent = fmt(st.min);
        rate.textContent = `${(st.n / Math.max(0.001, (Date.now() - st.t0) / 1000)).toFixed(1)} readings/s · span ${span.value} kHz`;
        onReading?.(m); draw();
      } catch (e) { con.err('meter: ' + e.message); break; }
    }
    if (st.on) stop();
  }
  async function start() {
    const sa = getSa(); if (!sa || st.on) return;
    if (onStart && onStart() === false) return;
    st.on = true; reset(); run.textContent = 'Stop'; run.classList.add('running'); run.setAttribute('aria-pressed', 'true');
    loop();
  }
  async function stop() {
    if (!st.on) return;
    st.on = false; run.textContent = 'Start'; run.classList.remove('running'); run.setAttribute('aria-pressed', 'false');
    const sa = getSa(); if (sa) { try { await sa.resume(); } catch {} }   // scanraw froze the device screen
    onStop?.();
  }
  run.addEventListener('click', () => { if (st.on) stop(); else start(); });
  freq.addEventListener('change', () => { if (st.on) reset(); });
  new ResizeObserver(draw).observe(canvas);
  function setEnabled(on) { run.disabled = !on; if (!on && st.on) stop(); }
  setEnabled(false);
  return { start, stop, setEnabled, get on() { return st.on; }, get history() { return st.history; } };
}
