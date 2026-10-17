// settings.js — persisted user settings (localStorage) and the Settings panel.
// SPDX-License-Identifier: GPL-2.0-only
import { PALETTES, DEFAULT_PALETTE, cssGradient } from '../plot/palettes.js';

const KEY = 'tinysa-web.settings';
const DEFAULTS = {
  theme: 'dark',          // 'dark' | 'light'
  traces: 'instrument',   // 'instrument' (yellow/magenta/cyan) | 'blueamber'
  palette: DEFAULT_PALETTE,
  refDbm: 0,              // top of the level axis
  floorDbm: -110,         // bottom of the level axis / waterfall colour floor
  rawBytes: false,        // echo every received chunk in the console
  maxMarkers: 6,
  avgCount: 8,            // page-side average depth
  scaleOverride: '',      // '' = by model; else a number used for scanraw decode
  overlayShow: true,      // draw the loaded overlay
  resumeOnDisconnect: true,
};

export const settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
settings.maxMarkers = DEFAULTS.maxMarkers;   // not user-editable yet

export function save() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {} }

/** Apply theme + trace scheme to the document. */
export function applyTheme() {
  const root = document.documentElement;
  root.setAttribute('data-theme', settings.theme);
  root.setAttribute('data-traces', settings.traces);
}
export const levelRange = () => [Math.min(settings.floorDbm, settings.refDbm - 10), settings.refDbm];

/** Wire the settings form. onChange(key) is called after any change. */
export function initSettingsPanel(form, onChange) {
  const sel = form.querySelector('[name=palette]');
  sel.innerHTML = Object.entries(PALETTES).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('');
  const swatch = form.querySelector('.palette-swatch');
  const refresh = () => {
    form.querySelector(`[name=theme][value=${settings.theme}]`).checked = true;
    form.querySelector(`[name=traces][value=${settings.traces}]`).checked = true;
    sel.value = settings.palette; swatch.style.background = cssGradient(settings.palette);
    form.querySelector('[name=refDbm]').value = String(settings.refDbm);
    form.querySelector('[name=floorDbm]').value = String(settings.floorDbm);
    form.querySelector('[name=avgCount]').value = settings.avgCount;
    form.querySelector('[name=scaleOverride]').value = settings.scaleOverride;
    for (const k of ['rawBytes', 'overlayShow', 'resumeOnDisconnect']) form.querySelector(`[name=${k}]`).checked = settings[k];
  };
  refresh();
  form.addEventListener('change', e => {
    const el = e.target, n = el.name; if (!n) return;
    if (el.type === 'checkbox') settings[n] = el.checked;
    else if (n === 'refDbm' || n === 'floorDbm') settings[n] = parseInt(el.value, 10);
    else if (n === 'avgCount') settings[n] = Math.min(64, Math.max(2, parseInt(el.value, 10) || 8));
    else if (n === 'scaleOverride') settings[n] = el.value.trim() === '' ? '' : (parseFloat(el.value) || '');
    else settings[n] = el.value;
    save(); applyTheme(); swatch.style.background = cssGradient(settings.palette); onChange(n);
  });
  form.addEventListener('submit', e => e.preventDefault());
}
