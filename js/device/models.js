// models.js — per-model operating envelopes for the tinySA line.
// SPDX-License-Identifier: GPL-2.0-only
//
// These are the page's *checking* envelope (what it will let you ask for),
// not live device state. Values follow tsapython/core.py (Ultra: 450 points,
// 100 kHz floor, scanraw scale 174) and the tinySA wiki for the Basic (290
// points, scale 128). Add a model here and a pattern in detectModel().
//
// scale: scanraw samples decode as dBm = value / 32 − scale.

export const MODELS = {
  TINYSA_BASIC:      { name: 'tinySA (Basic)', minHz: 100e3, maxHz: 960e6,  minPts: 3, maxPts: 290, quick: 101, scale: 128, screen: [320, 240], markers: 4, lna: false, ultra: false, rbw: [3, 10, 30, 100, 300, 600] },
  TINYSA_ULTRA:      { name: 'tinySA Ultra',   minHz: 100e3, maxHz: 5.3e9,  minPts: 3, maxPts: 450, quick: 200, scale: 174, screen: [480, 320], markers: 4, lna: true,  ultra: true,  rbw: [0.2, 1, 3, 10, 30, 100, 300, 600, 850] },
  TINYSA_ULTRA_PLUS: { name: 'tinySA Ultra+',  minHz: 100e3, maxHz: 7.3e9,  minPts: 3, maxPts: 450, quick: 200, scale: 174, screen: [480, 320], markers: 4, lna: true,  ultra: true,  rbw: [0.2, 1, 3, 10, 30, 100, 300, 600, 850] },
  TINYSA_GENERIC:    { name: 'Generic',        minHz: 100e3, maxHz: 960e6,  minPts: 3, maxPts: 290, quick: 101, scale: 128, screen: [320, 240], markers: 4, lna: false, ultra: false, rbw: [3, 10, 30, 100, 300, 600] },
};
export const DEFAULT_MODEL = 'TINYSA_ULTRA';

/** Guess the model key from the `version` and `info` replies. */
export function detectModel(version, info) {
  const t = `${version}\n${info}`.toLowerCase();
  if (/ultra\s*\+|ultra\s*plus|zs-?407|tinysa5/.test(t)) return 'TINYSA_ULTRA_PLUS';
  if (/ultra|tinysa4|zs-?40[56]/.test(t)) return 'TINYSA_ULTRA';
  if (/tinysa_v|tinysa\s*basic|\btinysa\b/.test(t)) return 'TINYSA_BASIC';
  return 'TINYSA_GENERIC';
}
