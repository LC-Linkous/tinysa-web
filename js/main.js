// main.js — application state and wiring. Everything else is a module.
// SPDX-License-Identifier: GPL-2.0-only
import { TinySA } from './device/tinysa.js';
import { SerialLink, hasWebSerial } from './device/serial-link.js';
import { DemoLink } from './device/demo-link.js';
import { MODELS, DEFAULT_MODEL, detectModel } from './device/models.js';
import { fmtHz, nearestIndex, peakIndex, findPeaks, holdMax, holdMin, averageInto, noiseFloor, medianFilter, meanFilter, interpolatePeak, bandwidth3dB, channelPowerDbm } from './sa.js';
import { renderSpectrum } from './plot/spectrum.js';
import { renderWaterfall, WATERFALL_ROWS } from './plot/waterfall.js';
import { renderPeakHistory } from './plot/peakhist.js';
import { createPanes } from './ui/panes.js';
import { initGenerator, renderGenerator } from './ui/generator.js';
import { buildLut, cssGradient } from './plot/palettes.js';
import { cssVar } from './plot/common.js';
import { settings, applyTheme, initSettingsPanel, save as saveSettings, levelRange } from './ui/settings.js';
import { initConsole } from './ui/console.js';
import { initSidebar } from './ui/sidebar.js';
import { collectDiagnostics } from './ui/diagnostics.js';
import { download, stamp, csvBlob, canvasPng, rgbaToPngDownload } from './ui/export.js';
import { sessionBlob, parseSession, parseCsv, pickFile } from './ui/session.js';
import { initDeviceTools } from './ui/devicetools.js';
import { initLevels } from './ui/levels.js';
import { createRecorder } from './ui/recorder.js';

const APP_VERSION = '0.3.1';
const PEAK_HISTORY = 600;
const SMOOTH = ['off', 'median5', 'mean5'];
const $ = id => document.getElementById(id);

// ---------------------------------------------------------------- state
const state = {
  sa: null, demo: false,
  sweep: null, held: null, overlay: null, history: [], markers: [],
  layers: { max: null, min: null, avg: null }, maxOn: false, minOn: false, avgOn: false, avgN: 0,
  peaks: [], devMarkers: [], smooth: 'off', mode: 'rx',
  continuous: false, busy: false, diag: null, scaleCheck: null,
  lut: buildLut(settings.palette),
};
const chart = { dirty: true, hover: null, geoms: [] };

applyTheme();
const sidebar = initSidebar($('sidebar'));
const con = initConsole({ log: $('log'), form: $('sendForm'), input: $('sendInput'), handle: $('conHandle'), drawer: $('console'), clearBtn: $('conClear'), copyBtn: $('conCopy'), dlBtn: $('conDl'), dlMode: $('conDlMode') }, sendManual);
const recorder = createRecorder();
const tools = initDeviceTools($('toolsSection'), () => state.sa, con);
const levels = initLevels($('levelsSection'), () => state.sa, con);
const generator = initGenerator($('genSection'), () => state.sa, con);
generator.onChange = () => { chart.dirty = true; };
const VIEWS = { spectrum: 'Spectrum', waterfall: 'Waterfall', peakhist: 'Peak history', generator: 'Generator' };
const panes = createPanes($('panes'), VIEWS, () => { wirePanes(); ensureGenPane(); buildLegend(); chart.dirty = true; },
  { key: 'tinysa-web.panes', defaults: ['spectrum', 'waterfall', 'peakhist', 'generator'] });
/** In generator mode one window always shows the generator. */
function ensureGenPane() { if (state.mode === 'tx' && !panes.panes.some(p => p.view === 'generator')) panes.setView(0, 'generator'); }

function setFreezeUi(frozen) { const b = $('freezeBtn'); b.setAttribute('aria-pressed', String(frozen)); b.textContent = frozen ? 'Device frozen — click to resume' : 'Freeze device screen'; b.classList.toggle('running', frozen); }
$('freezeBtn').addEventListener('click', async () => { const v = state.sa; if (!v || state.busy) return; try { if (v.paused) await v.resume(); else await v.pause(); setFreezeUi(v.paused); } catch (e) { con.err(e.message); } });

// ---------------------------------------------------------------- model / status
function setStatus(text, cls) { $('statusText').textContent = text; $('status').className = 'status ' + (cls || ''); }
function applyModel(key) {
  const m = MODELS[key]; if (!m) return;
  if (state.sa) state.sa.model = key;
  $('ptsMaxLabel').textContent = m.maxPts; $('ptsQuickLabel').textContent = m.quick;
  $('ptsCustom').min = m.minPts; $('ptsCustom').max = m.maxPts; if (+$('ptsCustom').value > m.maxPts) $('ptsCustom').value = m.maxPts;
  $('devRange').textContent = `${fmtHz(m.minHz)} – ${fmtHz(m.maxHzUltra)}${m.maxHzUltra !== m.maxHz ? ' (' + fmtHz(m.maxHz) + ' without ultra mode)' : ''}, ${m.minPts}–${m.maxPts} pts, ${m.markers} markers, scale ${m.scale}${m.verified === 'source' ? ' · limits from firmware source, not yet checked on this board' : ''}`;
  levels.fillRbw(m);
}
function currentModel() { return state.sa ? state.sa.model : ($('modelSel').value === 'auto' ? DEFAULT_MODEL : $('modelSel').value); }
function setEnabled(on) {
  ['singleBtn', 'contBtn', 'diagBtn', 'shotBtn', 'devSweepBtn', 'devDataBtn', 'sessSave', 'syncMarkersBtn', 'devPeakBtn', 'freezeBtn', 'modeTx', 'scaleChkBtn', 'calStateBtn'].forEach(id => $(id).disabled = !on);
  con.setEnabled(on); tools.setEnabled(on); levels.setEnabled(on); generator.setEnabled(on && state.mode === 'tx');
  $('battBadge').hidden = !on; if (!on) { $('battBadge').textContent = '—'; }
  $('demoBtn').disabled = on && !state.demo;
  $('demoBtn').classList.toggle('demo-active', on && state.demo); $('demoBtn').setAttribute('aria-pressed', String(on && state.demo));
  $('demoBtn').textContent = on && state.demo ? 'Demo mode (click to leave)' : 'Try without hardware';
  $('connectBtn').textContent = on ? 'Disconnect' : 'Connect to tinySA';
}

// ---------------------------------------------------------------- connect
async function connect(demo) {
  if (state.sa) return;
  const link = demo ? new DemoLink() : new SerialLink();
  link.onTx = cmd => con.tx(cmd);
  link.onRx = (body, meta) => con.reply(body, meta);
  link.onRaw = bytes => { if (settings.rawBytes) con.dim('rx ' + bytes.length + ' B: ' + JSON.stringify(new TextDecoder().decode(bytes)).slice(0, 200)); };
  if (!demo) link.onDrop = e => { con.err('port error: ' + e.message); disconnect(true); };
  const sa = new TinySA(link);
  sa.scaleOverride = settings.scaleOverride === '' ? undefined : settings.scaleOverride;
  sa.onWarning = t => con.err('warning: ' + t);
  try {
    await link.open();
    if (demo) con.dim('demo tinySA Ultra ready (no hardware)');
    const override = $('modelSel').value === 'auto' ? null : $('modelSel').value;
    await sa.identify(override);
    state.sa = sa; state.demo = demo; levels.reset();
    applyModel(sa.model);
    setStatus(`${demo ? 'Demo' : 'Connected'} · ${sa.ident.label} · as ${sa.env.name}`, demo ? 'demo' : 'ok');
    if (sa.deviceSweep && Number.isFinite(sa.deviceSweep.start)) $('devWas').textContent = `${fmtHz(sa.deviceSweep.start)} – ${fmtHz(sa.deviceSweep.stop)}${sa.deviceSweep.pts ? ', ' + sa.deviceSweep.pts + ' pts' : ''} (restored on disconnect)`;
    setEnabled(true); chart.dirty = true; pollBattery();
  } catch (e) {
    con.err('connect failed: ' + e.message); setStatus('Connection failed — ' + e.message, 'err');
    try { await link.close(); } catch {}
  }
}
async function disconnect(silent) {
  if (!state.sa) return;
  const sa = state.sa; stopContinuous();
  try { if (!silent && state.mode === 'tx') await generator.leave(); } catch {}
  try { if (!silent && settings.resumeOnDisconnect) { await sa.restoreDeviceSweep(); await sa.resume(); } } catch {}
  if (state.mode === 'tx') setMode('rx', true);
  setFreezeUi(false);
  await sa.link.close(); state.sa = null; state.demo = false; $('devWas').textContent = '—';
  setEnabled(false); setStatus('Not connected', ''); chart.dirty = true;
}

// ---------------------------------------------------------------- sweep
const mhz = id => parseFloat($(id).value) * 1e6;
function sweepParams() {
  const m = MODELS[currentModel()];
  const mode = document.querySelector('input[name=pts]:checked').value;
  const pts = mode === 'max' ? m.maxPts : mode === 'quick' ? m.quick : Math.round(+$('ptsCustom').value || m.maxPts);
  let start, stop;
  if (document.querySelector('input[name=fmode]:checked').value === 'centerspan') { const c = mhz('fCenter'), s = mhz('fSpan'); start = c - s / 2; stop = c + s / 2; }
  else { start = mhz('fStart'); stop = mhz('fStop'); }
  return { start: Math.max(0, Math.round(start)), stop: Math.round(stop), pts: Math.min(Math.max(pts, m.minPts), m.maxPts), method: document.querySelector('input[name=method]:checked').value };
}
function sameGrid(a, b) { return a && b && a.pts === b.pts && a.start === b.start && a.stop === b.stop; }
function resetLayers() { state.layers = { max: null, min: null, avg: null }; state.avgN = 0; }
function applySmoothing(sw) { const raw = sw.raw || sw.dbm; sw.raw = raw; sw.dbm = state.smooth === 'median5' ? medianFilter(raw, 5) : state.smooth === 'mean5' ? meanFilter(raw, 5) : raw; }
function acceptSweep(sw) {
  if (!sameGrid(state.sweep, sw)) { resetLayers(); state.history = []; state.peaks = []; }
  recorder.addSweep(sw);                 // raw, before display smoothing
  applySmoothing(sw); state.sweep = sw;
  const pi = peakIndex(sw.dbm), pk = interpolatePeak(sw.f, sw.dbm, pi);
  state.peaks.push({ t: sw.t, f: pk.f, dbm: pk.dbm }); if (state.peaks.length > PEAK_HISTORY) state.peaks.shift();
  const L = state.layers;
  if (state.maxOn) L.max = L.max ? holdMax(L.max, sw.dbm) : sw.dbm.slice();
  if (state.minOn) L.min = L.min ? holdMin(L.min, sw.dbm) : sw.dbm.slice();
  if (state.avgOn) { state.avgN = Math.min(state.avgN + 1, settings.avgCount); L.avg = L.avg ? averageInto(L.avg, sw.dbm, state.avgN) : sw.dbm.slice(); }
  $('sweepTime').textContent = `${(sw.ms / 1000).toFixed(2)} s · ${sw.pts} pts · ${sw.method}` + (sw.glitches ? ` · ${sw.glitches} ':' glitch${sw.glitches === 1 ? '' : 'es'}` : '');
  state.history.unshift(sw.dbm.slice()); if (state.history.length > WATERFALL_ROWS) state.history.pop();
  ['csvBtn', 'pngBtn', 'clearBtn', 'peakBtn', 'peaksBtn', 'clearMarkersBtn'].forEach(id => $(id).disabled = false);
  chart.dirty = true; renderMarkers();
}
async function doSweep() {
  if (!state.sa || state.busy || state.mode === 'tx') return null;
  const { start, stop, pts, method } = sweepParams();
  state.busy = true; $('singleBtn').disabled = true; if (!state.continuous) { $('singleBtn').textContent = 'Sweeping…'; $('singleBtn').classList.add('busy'); }
  try {
    const sw = method === 'scanraw' ? await state.sa.scanRaw(start, stop, pts, { quiet: state.continuous }) : await state.sa.scan(start, stop, pts, { quiet: state.continuous });
    if (state.continuous) con.dim(`${sw.cmd} → ${sw.pts} pts, ${sw.ms.toFixed(0)} ms`);
    acceptSweep(sw);
    // scanraw leaves the device's own screen frozen (tsapython: call resume() afterwards)
    if (method === 'scanraw' && !state.continuous) await state.sa.resume().catch(() => {});
    return sw;
  } catch (e) { con.err('sweep failed: ' + e.message); return null; }
  finally { state.busy = false; $('singleBtn').disabled = !state.sa || state.continuous; $('singleBtn').textContent = 'Single sweep'; $('singleBtn').classList.remove('busy'); }
}
function stopContinuous() { state.continuous = false; const b = $('contBtn'); b.textContent = 'Continuous'; b.classList.remove('running'); b.setAttribute('aria-pressed', 'false'); $('singleBtn').disabled = !state.sa; }
async function continuousLoop() {
  const b = $('contBtn'); b.textContent = 'Stop'; b.classList.add('running'); b.setAttribute('aria-pressed', 'true'); $('singleBtn').disabled = true;
  let usedRaw = false;
  while (state.continuous && state.sa) { const s = await doSweep(); if (s && s.method === 'scanraw') usedRaw = true; await new Promise(r => setTimeout(r, s ? 30 : 500)); }
  stopContinuous();
  if (usedRaw && state.sa && !state.busy) { state.busy = true; try { await state.sa.resume(); } catch {} finally { state.busy = false; } }
}
async function useDeviceSweep() {
  if (!state.sa || state.busy) return; state.busy = true;
  try { const s = await state.sa.sweep(); if (Number.isFinite(s.start) && Number.isFinite(s.stop)) { document.querySelector('input[name=fmode][value=startstop]').checked = true; syncFreqMode(); $('fStart').value = (s.start / 1e6).toPrecision(6).replace(/\.?0+$/, ''); $('fStop').value = (s.stop / 1e6).toPrecision(6).replace(/\.?0+$/, ''); if (s.pts) { document.querySelector('input[name=pts][value=custom]').checked = true; $('ptsCustom').value = s.pts; } con.dim(`device sweep: ${fmtHz(s.start)} – ${fmtHz(s.stop)}, ${s.pts || '?'} pts`); } else con.err('could not parse the device sweep reply'); }
  catch (e) { con.err(e.message); } finally { state.busy = false; }
}
async function readDeviceData() {
  if (!state.sa || state.busy) return; state.busy = true;
  try {
    const t0 = performance.now(); const f = await state.sa.frequencies(); const dbm = await state.sa.data(0);
    const pts = Math.min(f.length, dbm.length);
    if (pts < 2) throw new Error('device returned no sweep data');
    acceptSweep({ pts, start: f[0], stop: f[pts - 1], f: Float64Array.from(f.slice(0, pts)), dbm: dbm.slice(0, pts), t: Date.now(), ms: performance.now() - t0, cmd: 'data 0', method: 'data' });
    con.dim(`read ${pts} points from the device's current trace`);
  } catch (e) { con.err(e.message); } finally { state.busy = false; }
}
function syncFreqMode() { const cs = document.querySelector('input[name=fmode]:checked').value === 'centerspan'; $('fStartStop').hidden = cs; $('fCenterSpan').hidden = !cs; }
document.querySelectorAll('input[name=fmode]').forEach(r => r.addEventListener('change', () => {
  // carry the range across when switching entry mode
  if (r.value === 'centerspan' && r.checked) { const a = mhz('fStart'), b = mhz('fStop'); $('fCenter').value = ((a + b) / 2 / 1e6).toPrecision(8).replace(/\.?0+$/, ''); $('fSpan').value = ((b - a) / 1e6).toPrecision(6).replace(/\.?0+$/, ''); }
  else if (r.checked) { const c = mhz('fCenter'), s = mhz('fSpan'); $('fStart').value = (Math.max(0, c - s / 2) / 1e6).toPrecision(8).replace(/\.?0+$/, ''); $('fStop').value = ((c + s / 2) / 1e6).toPrecision(8).replace(/\.?0+$/, ''); }
  syncFreqMode();
}));

// ---------------------------------------------------------------- chart (panes)
function renderPane(pane) {
  const canvas = pane.canvas, dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return null;
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const v = pane.view, sw = state.sweep, ov = settings.overlayShow && state.overlay ? state.overlay.sweep : null;
  if (v === 'generator') { renderGenerator(ctx, W, H, generator.gen); return null; }
  if (v === 'peakhist') { renderPeakHistory(ctx, W, H, state.peaks, levelRange()); return null; }
  if (!sw) { ctx.font = '13px ' + cssVar('--font'); ctx.fillStyle = cssVar('--ink-3'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(state.sa ? (state.mode === 'tx' ? 'Generator mode — switch to Analyzer to sweep.' : 'Run a sweep.') : 'Connect a tinySA or try the demo.', W / 2, H / 2); return null; }
  const hover = chart.hover;
  let g;
  if (v === 'waterfall') g = renderWaterfall(ctx, W, H, sw, state.history, state.markers, hover, state.lut, levelRange());
  else g = renderSpectrum(ctx, W, H, sw, state.layers, state.held, state.markers, hover, ov, levelRange());
  if (v === 'spectrum') drawExtras(ctx, g, sw);
  return g;
}
/** Noise-floor line and the device's own markers, on spectrum panes. */
function drawExtras(ctx, g, sw) {
  const nf = noiseFloor(sw.dbm), y = g.sy(nf);
  ctx.strokeStyle = cssVar('--ink-3'); ctx.setLineDash([2, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(g.pad.l, y); ctx.lineTo(g.pad.l + g.pw, y); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = cssVar('--ink-3'); ctx.font = '11px ' + cssVar('--font'); ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(`median ${nf.toFixed(1)} dBm`, g.pad.l + g.pw - 4, y - 2);
  for (const m of state.devMarkers) {
    if (m.f < sw.start || m.f > sw.stop) continue;
    const i = nearestIndex(sw.f, m.f), x = g.sx(sw.f[i]), yy = g.sy(m.dbm ?? sw.dbm[i]);
    ctx.strokeStyle = cssVar('--maxhold'); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, yy - 9); ctx.lineTo(x + 8, yy + 6); ctx.lineTo(x - 8, yy + 6); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = cssVar('--maxhold'); ctx.font = 'bold 11px ' + cssVar('--font'); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('D' + m.id, x, yy - 11);
  }
}
function renderAll() { chart.geoms = panes.panes.map(renderPane); }
function tick() { if (chart.dirty) { chart.dirty = false; renderAll(); } requestAnimationFrame(tick); }
const resizer = new ResizeObserver(() => chart.dirty = true);

function pointAt(pane, e) {
  const sw = state.sweep, g = chart.geoms[pane.i]; if (!sw || !g) return null;
  const r = pane.canvas.getBoundingClientRect(), mx = e.clientX - r.left;
  if (mx < g.pad.l || mx > g.pad.l + g.pw) return null;
  return nearestIndex(sw.f, g.fx(mx));
}
function wirePanes() {
  for (const pane of panes.panes) {
    if (pane.wired) continue; pane.wired = true; resizer.observe(pane.canvas);
    pane.canvas.addEventListener('pointermove', e => {
      if (!['spectrum', 'waterfall'].includes(pane.view)) return;
      const i = pointAt(pane, e); if (i !== chart.hover) { chart.hover = i; chart.dirty = true; }
      if (i == null) { pane.tip.style.display = 'none'; return; }
      const sw = state.sweep, g = chart.geoms[pane.i], L = state.layers;
      pane.tip.style.display = 'block'; pane.tip.style.left = g.sx(sw.f[i]) + 'px'; pane.tip.style.top = g.sy(sw.dbm[i]) + 'px';
      pane.tip.textContent = `${fmtHz(sw.f[i])}  ${sw.dbm[i].toFixed(1)} dBm` + (L.max ? `  max ${L.max[i].toFixed(1)}` : '') + (L.min ? `  min ${L.min[i].toFixed(1)}` : '') + (L.avg ? `  avg ${L.avg[i].toFixed(1)}` : '');
    });
    pane.canvas.addEventListener('pointerleave', () => { chart.hover = null; chart.dirty = true; pane.tip.style.display = 'none'; });
    pane.canvas.addEventListener('click', e => { if (!['spectrum', 'waterfall'].includes(pane.view)) return; const i = pointAt(pane, e); if (i == null) return; addMarker(state.sweep.f[i]); });
  }
  document.querySelectorAll('[data-layout]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.layout === panes.layout)));
}
function toggleLayer(which) {
  const key = which + 'On'; state[key] = !state[key];
  $(which + 'Btn').setAttribute('aria-pressed', String(state[key]));
  if (!state[key]) { state.layers[which] = null; if (which === 'avg') state.avgN = 0; }
  else if (state.sweep) { state.layers[which] = state.sweep.dbm.slice(); if (which === 'avg') state.avgN = 1; }
  buildLegend(); renderMarkers(); chart.dirty = true;
}
function cycleSmooth() {
  state.smooth = SMOOTH[(SMOOTH.indexOf(state.smooth) + 1) % SMOOTH.length];
  const b = $('smoothBtn'); b.textContent = 'Smooth: ' + { off: 'off', median5: 'median 5', mean5: 'mean 5' }[state.smooth]; b.setAttribute('aria-pressed', String(state.smooth !== 'off'));
  if (state.sweep) { applySmoothing(state.sweep); renderMarkers(); }
  chart.dirty = true;
}

// ---------------------------------------------------------------- mode (analyzer / generator)
async function setMode(mode, silent) {
  if (mode === state.mode) return;
  if (state.sa && !silent) {
    if (state.busy) { con.err('busy — stop the sweep first'); return; }
    state.busy = true;
    try {
      if (mode === 'tx') { stopContinuous(); state.mode = 'tx'; if (!await generator.enter()) { state.mode = 'rx'; return; } }
      else { await generator.leave(); state.mode = 'rx'; }
    } finally { state.busy = false; }
  } else state.mode = mode;
  $('modeRx').setAttribute('aria-pressed', String(state.mode === 'rx')); $('modeTx').setAttribute('aria-pressed', String(state.mode === 'tx'));
  document.querySelectorAll('.sidebar section[data-mode]').forEach(sec => sec.classList.toggle('off', sec.dataset.mode !== 'all' && sec.dataset.mode !== state.mode));
  if (state.mode === 'tx') { sidebar.open('generator'); ensureGenPane(); } else sidebar.open('sweep');
  document.querySelector('.markers-panel').hidden = state.mode === 'tx';
  document.querySelector('[aria-label="Trace math"]').hidden = state.mode === 'tx';
  ['singleBtn', 'contBtn', 'devSweepBtn', 'devDataBtn'].forEach(id => $(id).disabled = !state.sa || state.mode === 'tx');
  generator.setEnabled(!!state.sa && state.mode === 'tx');
  chart.dirty = true;
}

// ---------------------------------------------------------------- battery / status poll
let battTimer = null;
async function pollBattery() {
  clearTimeout(battTimer); if (!state.sa) return;
  if (!state.busy) {
    try { const v = await state.sa.link.command('vbat', { timeoutMs: 2000, quiet: true }); const st = await state.sa.link.command('status', { timeoutMs: 2000, quiet: true });
      const mv = parseInt(v.body, 10); $('battBadge').textContent = `${Number.isFinite(mv) ? (mv / 1000).toFixed(2) + ' V' : v.body.trim()} · ${st.body.trim().toLowerCase() || '?'}`;
      $('battBadge').className = 'badge ' + (Number.isFinite(mv) && mv < 3600 ? 'warn' : '');
    } catch {}
  }
  battTimer = setTimeout(pollBattery, 30000);
}

// ---------------------------------------------------------------- markers
function addMarker(f) { if (state.markers.length >= settings.maxMarkers) state.markers.shift(); state.markers.push(f); renderMarkers(); chart.dirty = true; }
function renderMarkers() {
  const body = $('markerBody'); body.innerHTML = ''; const sw = state.sweep; if (!sw) { $('markerEmpty').hidden = false; return; }
  const devN = state.sa ? (state.sa.env.markers || 4) : 4;
  const ref = state.markers.length ? nearestIndex(sw.f, state.markers[0]) : null;
  state.markers.forEach((mf, k) => {
    const i = nearestIndex(sw.f, mf), L = state.layers;
    const isPk = i > 0 && i < sw.pts - 1 && sw.dbm[i] >= sw.dbm[i - 1] && sw.dbm[i] >= sw.dbm[i + 1];
    const pk = isPk ? interpolatePeak(sw.f, sw.dbm, i) : { f: sw.f[i], dbm: sw.dbm[i] };
    const bw = isPk ? bandwidth3dB(sw.f, sw.dbm, i) : null;
    const tr = document.createElement('tr');
    const dl = k === 0 || ref == null ? '—' : (sw.dbm[i] - sw.dbm[ref]).toFixed(1), df = k === 0 || ref == null ? '—' : (sw.f[i] - sw.f[ref] >= 0 ? '+' : '−') + fmtHz(Math.abs(sw.f[i] - sw.f[ref]));
    tr.innerHTML = `<td>${k + 1}${k >= devN ? ' <span class="hint" title="Beyond the device\'s marker count — page only">(page)</span>' : ''}</td><td title="${isPk ? 'parabolic interpolation between bins' : 'bin centre'}">${fmtHz(pk.f, 4)}${isPk ? '*' : ''}</td><td>${pk.dbm.toFixed(1)}</td><td>${L.max ? L.max[i].toFixed(1) : '—'}</td><td>${bw == null ? '—' : fmtHz(bw, 1)}</td><td>${dl}</td><td>${df}</td><td><button type="button" title="Remove marker" data-k="${k}">×</button></td>`;
    body.appendChild(tr);
  });
  $('markerEmpty').hidden = state.markers.length > 0;
  if (state.markers.length >= 2) { const a = nearestIndex(sw.f, state.markers[0]), b = nearestIndex(sw.f, state.markers[1]), lo = Math.min(a, b), hi = Math.max(a, b); $('bandPower').textContent = `Band power M1–M2: ${channelPowerDbm(sw.dbm, lo, hi).toFixed(1)} dBm over ${fmtHz(sw.f[hi] - sw.f[lo])} (${hi - lo + 1} bins summed, no RBW normalisation). * = interpolated peak.`; }
  else $('bandPower').textContent = state.markers.length ? '* = peak frequency by parabolic interpolation between bins.' : '';
  $('syncMarkersBtn').textContent = `Send first ${devN} to device`;
}
function buildLegend() {
  if (state.mode === 'tx') { $('legend').innerHTML = `<span><i style="background:${cssVar('--trace')}"></i>nominal generator output (as commanded)</span>`; return; }
  const v = panes.panes.some(p => p.view === 'spectrum') ? 'spectrum' : panes.panes[0].view; let items = [['--trace', 'live']];
  if (v === 'waterfall') { const [a, b] = levelRange(); items = [['--trace', 'live'], [`background:${cssGradient(settings.palette)}`, `${a} → ${b} dBm`]]; }
  else {
    if (state.layers.max) items.push(['--maxhold', 'max hold']);
    if (state.layers.min) items.push(['--minhold', 'min hold']);
    if (state.layers.avg) items.push(['--avg', `average (${settings.avgCount})`]);
    if (state.held) items.push(['--held', 'held trace']);
    if (state.overlay && settings.overlayShow) items.push(['--overlay', `overlay: ${state.overlay.name}`]);
    if (state.devMarkers.length) items.push(['--maxhold', state.devMarkers.length === 1 ? 'D1: device marker' : `D1–D${state.devMarkers.length}: device markers`]);
  }
  if (state.smooth !== 'off') items.push(['--ink-3', `smoothed (${state.smooth})`]);
  $('legend').innerHTML = items.map(([c, l]) => `<span><i style="${c.startsWith('--') ? 'background:' + cssVar(c) : c}"></i>${l}</span>`).join('');
}
async function askDevicePeak() {
  const sa = state.sa, sw = state.sweep, st = $('markerStatus'); if (!sa || !sw) return; if (state.busy) { st.textContent = 'busy — stop the sweep first'; return; } state.busy = true; st.textContent = 'asking…'; st.className = 'hint';
  try {
    await sa.markerPeak(1); state.devMarkers = await sa.markersList();
    const d = state.devMarkers.find(m => m.id === 1); const pi = peakIndex(sw.dbm), pk = interpolatePeak(sw.f, sw.dbm, pi);
    st.textContent = d ? `Device peak ${fmtHz(d.f, 4)}${d.dbm != null ? ` ${d.dbm.toFixed(1)} dBm` : ''} · page peak ${fmtHz(pk.f, 4)} ${pk.dbm.toFixed(1)} dBm · Δ ${fmtHz(Math.abs(d.f - pk.f))}` : 'device replied, but no marker could be read from the reply (format unverified — see PROTOCOL.md)';
    if (!d) st.className = 'hint err';
  } catch (e) { st.textContent = e.message; st.className = 'hint err'; con.err(e.message); }
  finally { state.busy = false; chart.dirty = true; buildLegend(); }
}
async function syncMarkersToDevice() {
  const sa = state.sa, sw = state.sweep; if (!sa || !sw || state.busy) return; state.busy = true;
  const st = $('markerStatus'); st.textContent = 'sending…'; st.className = 'hint';
  try {
    const r = await sa.syncMarkers(state.markers);
    if (r.error) { st.textContent = `Stopped after ${r.sent} marker(s): ${r.error}`; st.className = 'hint err'; con.err(r.error); }
    else { st.textContent = `Sent ${r.sent} marker(s) to the device by frequency` + (r.skipped ? `; ${r.skipped} page-only` : ''); con.dim(st.textContent); }
  } finally { state.busy = false; }
}

// ---------------------------------------------------------------- session / overlay
function setOverlay(ov) {
  state.overlay = ov; $('ovlClear').disabled = !ov;
  $('ovlName').textContent = ov ? `Overlay: ${ov.name} — ${ov.sweep.pts} pts, ${fmtHz(ov.sweep.start)} – ${fmtHz(ov.sweep.stop)}` : 'No overlay loaded. A loaded frequency,dBm CSV is drawn dotted under the live trace; toggle it in Settings.';
  buildLegend(); chart.dirty = true;
}
async function loadOverlay() {
  const file = await pickFile('.csv,.txt'); if (!file) return;
  try { setOverlay(parseCsv(await file.text(), file.name)); con.dim(`overlay loaded: ${file.name}`); } catch (e) { con.err('overlay: ' + e.message); }
}
async function loadSession() {
  const file = await pickFile('.json'); if (!file) return;
  try {
    const d = parseSession(await file.text());
    if (d.sweep) acceptSweep(d.sweep); state.held = d.held || null; $('holdBtn').setAttribute('aria-pressed', String(!!state.held));
    state.markers = Array.isArray(d.markers) ? d.markers.slice(0, settings.maxMarkers) : [];
    if (d.settings) { Object.assign(settings, d.settings); saveSettings(); applyTheme(); state.lut = buildLut(settings.palette); }
    setOverlay(d.overlay || null); renderMarkers(); buildLegend(); chart.dirty = true;
    con.dim(`session loaded: ${file.name} (${d.when || 'no date'})`);
  } catch (e) { con.err('session: ' + e.message); }
}

// ---------------------------------------------------------------- manual console
async function sendManual(cmd) {
  if (!state.sa) { con.err('not connected'); return; }
  if (state.busy) { con.err('busy — stop the sweep first'); return; }
  try { await state.sa.raw(cmd); } catch (e) { con.err(e.message); }
}

// ---------------------------------------------------------------- wiring
if (!hasWebSerial()) { $('noSerial').hidden = false; $('connectBtn').disabled = true; }
$('connectBtn').addEventListener('click', () => state.sa ? disconnect() : connect(false));
$('demoBtn').addEventListener('click', () => state.sa ? disconnect() : connect(true));
$('modelSel').addEventListener('change', () => { const v = $('modelSel').value; applyModel(v === 'auto' ? (state.sa ? detectModel(state.sa.ident.version, state.sa.ident.info) : DEFAULT_MODEL) : v); });
$('singleBtn').addEventListener('click', () => doSweep());
$('contBtn').addEventListener('click', () => { if (state.continuous) stopContinuous(); else { state.continuous = true; continuousLoop(); } });
$('devSweepBtn').addEventListener('click', useDeviceSweep);
$('devDataBtn').addEventListener('click', readDeviceData);
document.querySelectorAll('[data-layout]').forEach(b => b.addEventListener('click', () => panes.setLayout(+b.dataset.layout)));
$('smoothBtn').addEventListener('click', cycleSmooth);
$('modeRx').addEventListener('click', () => setMode('rx'));
$('modeTx').addEventListener('click', () => setMode('tx'));
$('devPeakBtn').addEventListener('click', askDevicePeak);
['max', 'min', 'avg'].forEach(w => $(w + 'Btn').addEventListener('click', () => toggleLayer(w)));
$('holdBtn').addEventListener('click', () => { if (state.held) state.held = null; else if (state.sweep) state.held = { ...state.sweep, f: state.sweep.f.slice(), dbm: state.sweep.dbm.slice() }; $('holdBtn').setAttribute('aria-pressed', String(!!state.held)); buildLegend(); chart.dirty = true; });
$('clearBtn').addEventListener('click', () => { state.sweep = null; state.held = null; state.history = []; state.markers = []; state.peaks = []; state.devMarkers = []; resetLayers(); $('holdBtn').setAttribute('aria-pressed', 'false'); renderMarkers(); buildLegend(); chart.dirty = true; ['csvBtn', 'pngBtn', 'clearBtn', 'peakBtn', 'peaksBtn', 'clearMarkersBtn'].forEach(id => $(id).disabled = true); });
$('peakBtn').addEventListener('click', () => { if (state.sweep) addMarker(state.sweep.f[peakIndex(state.sweep.dbm)]); });
$('peaksBtn').addEventListener('click', () => { const sw = state.sweep; if (!sw) return; const idx = findPeaks(sw.dbm, { count: 4 }); if (!idx.length) { $('markerStatus').textContent = 'no peaks above the noise'; return; } state.markers = idx.map(i => sw.f[i]); renderMarkers(); chart.dirty = true; $('markerStatus').textContent = `${idx.length} peak(s) marked`; });
$('syncMarkersBtn').addEventListener('click', syncMarkersToDevice);
$('clearMarkersBtn').addEventListener('click', () => { state.markers = []; renderMarkers(); chart.dirty = true; });
$('markerBody').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.markers.splice(+b.dataset.k, 1); renderMarkers(); chart.dirty = true; });
$('csvBtn').addEventListener('click', () => download(`tinysa-${stamp()}.csv`, csvBlob(state.sweep)));
$('pngBtn').addEventListener('click', () => { const p = panes.panes[0]; canvasPng(p.canvas, `tinysa-${p.view}-${stamp()}.png`); });
$('shotBtn').addEventListener('click', async () => { if (!state.sa || state.busy) return; state.busy = true; try { const img = await state.sa.capture(); rgbaToPngDownload(img, `tinysa-screen-${stamp()}.png`); con.dim(`capture: ${img.width}×${img.height} in ${img.ms.toFixed(0)} ms`); } catch (e) { con.err('screenshot failed: ' + e.message); } finally { state.busy = false; } });
$('diagBtn').addEventListener('click', async () => { if (!state.sa || state.busy) return; state.busy = true; state.diag = null; $('diagBtn').disabled = true; $('diagDlBtn').disabled = true; $('diagOut').hidden = false; $('diagOut').textContent = 'collecting… (each command waits up to 8 s if the device is silent)'; try { state.diag = await collectDiagnostics(state.sa, sweepParams(), t => $('diagOut').textContent = t); } catch (e) { $('diagOut').textContent += '\nfailed: ' + e.message; } finally { state.busy = false; $('diagBtn').disabled = false; $('diagDlBtn').disabled = !state.diag; } });
$('scaleChkBtn').addEventListener('click', async () => {
  if (!state.sa || state.busy || state.mode === 'tx') return; state.busy = true; $('scaleApplyBtn').disabled = true; $('scaleOut').textContent = 'running scan then scanraw…';
  try {
    const { start, stop, pts } = sweepParams(); const n = Math.min(pts, 101);
    const a = await state.sa.scan(start, stop, n, { retries: 0 }); const b = await state.sa.scanRaw(start, stop, n); await state.sa.resume().catch(() => {});
    let sum = 0, sq = 0; for (let i = 0; i < n; i++) { const d = b.dbm[i] - a.dbm[i]; sum += d; sq += d * d; }
    const mean = sum / n, sd = Math.sqrt(Math.max(0, sq / n - mean * mean)), suggested = +(state.sa.scale + mean).toFixed(2);
    state.scaleCheck = { mean, sd, suggested, n };
    $('scaleOut').textContent = `scanraw − scan: mean ${mean >= 0 ? '+' : ''}${mean.toFixed(2)} dB, σ ${sd.toFixed(2)} dB over ${n} points (scale ${state.sa.scale}). ` + (Math.abs(mean) < 0.5 ? 'Agree — scale factor is right.' : `Offset — suggested scale ${suggested}.`);
    $('scaleApplyBtn').disabled = Math.abs(mean) < 0.5;
  } catch (e) { $('scaleOut').textContent = 'check failed: ' + e.message; } finally { state.busy = false; }
});
$('scaleApplyBtn').addEventListener('click', () => { const c = state.scaleCheck; if (!c) return; settings.scaleOverride = c.suggested; saveSettings(); if (state.sa) state.sa.scaleOverride = c.suggested; $('scaleOverride').value = c.suggested; $('scaleOut').textContent += ` Applied: scanraw now decodes with scale ${c.suggested} (Settings → scanraw scale factor).`; $('scaleApplyBtn').disabled = true; });
$('calStateBtn').addEventListener('click', async () => { if (!state.sa || state.busy) return; state.busy = true; try { const c = await state.sa.calState(); const dl = $('calState'); dl.hidden = false; dl.innerHTML = Object.entries(c).map(([k, v]) => `<dt>${k}</dt><dd>${v.replace(/</g, '&lt;') || '(empty)'}</dd>`).join(''); } catch (e) { con.err(e.message); } finally { state.busy = false; } });
$('diagDlBtn').addEventListener('click', () => state.diag && download(`tinysa-diag-${stamp()}.json`, new Blob([JSON.stringify(state.diag, null, 2)], { type: 'application/json' })));
$('sessSave').addEventListener('click', () => download(`tinysa-session-${stamp()}.json`, sessionBlob({ sweep: state.sweep, held: state.held, overlay: state.overlay, markers: state.markers, settings, model: state.sa?.model, ident: { ...state.sa?.ident, help: undefined }, appVersion: APP_VERSION })));
$('sessLoad').addEventListener('click', loadSession);
$('ovlLoad').addEventListener('click', loadOverlay);
$('ovlClear').addEventListener('click', () => setOverlay(null));
$('ptsCustom').addEventListener('focus', () => { document.querySelector('input[name=pts][value=custom]').checked = true; });
initSettingsPanel($('settingsForm'), key => {
  if (key === 'palette') state.lut = buildLut(settings.palette);
  if (key === 'scaleOverride' && state.sa) state.sa.scaleOverride = settings.scaleOverride === '' ? undefined : settings.scaleOverride;
  buildLegend(); chart.dirty = true;
});
window.addEventListener('beforeunload', () => { if (state.sa && !state.demo && settings.resumeOnDisconnect) state.sa.link.writeSync('resume\r\n'); });
if (hasWebSerial()) navigator.serial.addEventListener('disconnect', () => { if (state.sa && !state.demo) disconnect(true); });

// ---------------------------------------------------------------- recording
function refreshRec() {
  const n = recorder.sweeps.length;
  $('recSweeps').textContent = n; $('recSize').textContent = (recorder.bytes() / 1024).toFixed(0) + ' kB';
  $('recBtn').textContent = recorder.on ? 'Stop recording' : 'Start recording'; $('recBtn').classList.toggle('running', recorder.on); $('recBtn').setAttribute('aria-pressed', String(recorder.on));
  $('recBadge').hidden = !recorder.on; $('recBadge').textContent = `● REC ${n}`;
  $('recWfBtn').disabled = $('recSweepsBtn').disabled = $('recJsonBtn').disabled = $('recClearBtn').disabled = !n;
}
recorder.onChange = refreshRec;
$('recBtn').addEventListener('click', () => { if (recorder.on) recorder.stop(); else { recorder.start(); con.dim('recording started'); } });
$('recWfBtn').addEventListener('click', () => download(`tinysa-waterfall-${stamp()}.csv`, recorder.waterfallCsv()));
$('recSweepsBtn').addEventListener('click', () => download(`tinysa-sweeps-${stamp()}.csv`, recorder.sweepsCsv()));
$('recJsonBtn').addEventListener('click', () => download(`tinysa-recording-${stamp()}.json`, recorder.jsonBlob({ version: APP_VERSION, model: state.sa?.model, ident: { ...state.sa?.ident, help: undefined }, scale: state.sa?.scale })));
$('recClearBtn').addEventListener('click', () => { if (confirm('Discard the recording?')) recorder.clear(); });
window.addEventListener('beforeunload', e => { if (recorder.on && recorder.sweeps.length) { e.preventDefault(); e.returnValue = ''; } });
refreshRec();

$('appVersion').textContent = 'v' + APP_VERSION;
applyModel(DEFAULT_MODEL); syncFreqMode(); wirePanes(); renderMarkers(); setOverlay(null); buildLegend(); tick();
