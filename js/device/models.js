// models.js — per-model operating envelopes for the tinySA line.
// SPDX-License-Identifier: GPL-2.0-only
//
// Port of tsapython/_profiles.py and _identify.py (library 4.0.0). These are
// the page's *checking* envelope (what it will let you ask for), not live
// device state. Values come from the tinySA firmware source (nanovna.h,
// sa_cmd.c, main.c), not the wiki. The Ultra (ZS405) values were checked on
// hardware running tinySA4_v1.4-143 and v1.4-252; the Basic and Ultra+ are
// from the source only.
//
// scale: scanraw samples decode as dBm = value / 32 − scale.

const COMMON_COMMANDS = `version reset freq dac saveconfig clearconfig data frequencies scan scanraw abort zero sweep test
touchcal touchtest pause resume wait waitscan repeat status caloutput save recall trace trigger
marker line usart usart_cfg capture refresh touch release vbat vbat_offset help info color if
actual_freq attenuate level sweeptime leveloffset levelchange modulation rbw mode spur load
ext_gain output deviceid selftest correction calc menu text remark threads channel`.split(/\s+/);
const ULTRA_ONLY_COMMANDS = 'hop lna lna2 agc if1 freq_corr avoid direct ultra nf time restart usbdisk k sd_list sd_read sd_delete'.split(' ');

const BASIC = {
  key: 'TINYSA_BASIC', family: 'basic', board: 'ZS304', name: 'tinySA (Basic)', verified: 'source',
  minHz: 100e3, maxHz: 350e6, maxHzUltra: 350e6, sgMinHz: 100e3, sgMaxHz: 960e6,
  minPts: 3, maxPts: 290, quick: 101, scale: 128, screen: [320, 240], markers: 4, traces: 3,
  lna: false, ultra: false,
  rbw: [3, 10, 30, 100, 300, 600], rbwRange: [2, 600],
  modes: ['low', 'high'],
  modulations: ['off', 'am', 'nfm', 'wfm', 'extern'],
  outputWords: ['on', 'off'], spurWords: ['off', 'on'],
  calcWords: ['off', 'minh', 'maxh', 'maxd', 'aver4', 'aver16', 'aver', 'quasi'],
  levelLow: [-76, -6], levelHigh: [-38, 13],
  commands: new Set(COMMON_COMMANDS),
};
const ULTRA = {
  key: 'TINYSA_ULTRA', family: 'ultra', board: 'ZS405', name: 'tinySA Ultra', verified: 'hardware',
  minHz: 100e3, maxHz: 800e6, maxHzUltra: 5.33e9, sgMinHz: 100e3, sgMaxHz: 1130e6,
  minPts: 3, maxPts: 450, quick: 200, scale: 174, screen: [480, 320], markers: 8, traces: 4,
  lna: true, ultra: true,
  rbw: [0.2, 1, 3, 10, 30, 100, 300, 600, 850], rbwRange: [0.2, 850],
  modes: ['low'],
  modulations: ['off', 'am', 'fm'],
  outputWords: ['on', 'off', 'normal', 'mixer'], spurWords: ['off', 'on', 'auto'],
  calcWords: ['off', 'minh', 'maxh', 'maxd', 'aver4', 'aver16', 'aver', 'quasi', 'log', 'lin'],
  levelLow: [-76, -6], levelHigh: null,
  commands: new Set([...COMMON_COMMANDS, ...ULTRA_ONLY_COMMANDS]),
};

export const MODELS = {
  TINYSA_BASIC: BASIC,
  TINYSA_ULTRA: ULTRA,
  TINYSA_ULTRA_PLUS: { ...ULTRA, key: 'TINYSA_ULTRA_PLUS', board: 'ZS407', name: 'tinySA Ultra+', verified: 'source', maxHz: 900e6, maxHzUltra: 7.37e9 },
  TINYSA_ULTRA_PLUS_406: { ...ULTRA, key: 'TINYSA_ULTRA_PLUS_406', board: 'ZS406', name: 'tinySA Ultra+ (ZS406)', verified: 'source', maxHz: 900e6, maxHzUltra: 5.42e9 },
  // before a device is identified: the widest Ultra limits, as the library's DEFAULT profile
  TINYSA_GENERIC: { ...ULTRA, key: 'TINYSA_GENERIC', board: 'unknown', name: 'Generic (Ultra-family limits)', verified: 'source', maxHzUltra: 15e9 },
};
export const DEFAULT_MODEL = 'TINYSA_ULTRA';

/** Oldest firmware the page (and tsapython 4.0.0) is written for: v1.4-182, October 2024. */
export const FIRMWARE_FLOOR = [1, 4, 182];
/** Firmware builds at which behaviour the page relies on appeared (commit count after the v1.4 tag). */
export const BUILDS = { scanrawStream: 177, boardInInfo: 190, waitscan: 216, commandTimeout: 222, dBV: 235, usbdisk: 244 };

/** The Ultra family reports its board in the 'HW Version:' line; matched on the prefix (the suffix changes between builds). */
const ULTRA_BOARD_PREFIXES = [['V0.4.5', 'ZS405'], ['V0.4.6', 'ZS406'], ['V0.5.', 'ZS407']];

/** 'tinySA4_v1.4-252-g2b4aa51' → [1, 4, 252]; null when no build is printed. */
export function parseBuild(version) {
  const m = /v(\d+)\.(\d+)-(\d+)/.exec(version || '');
  return m ? [+m[1], +m[2], +m[3]] : null;
}
export function buildAtLeast(build, [a, b, c]) {
  if (!build) return false;
  return build[0] > a || (build[0] === a && (build[1] > b || (build[1] === b && build[2] >= c)));
}

/**
 * Identify the device from the `version` and `info` replies (tsapython identify_device()).
 * Returns { key, family, board, build, hw, firmware, modelName }.
 *   family: 'basic' when version starts tinySA_v, 'ultra' when tinySA4_, else 'unknown'
 *   board:  the board name info prints since v1.4-190 ('tinySA ULTRA ZS405') when present,
 *           else from 'HW Version' on the Ultra family, else 'ZS304' on the Basic
 */
export function identifyDevice(version, info) {
  const v = version || '', i = info || '';
  const firmware = v.split('\n')[0].trim();
  const hwm = /HW Version:\s*(\S+)/i.exec(v);
  const hw = hwm ? hwm[1] : '';
  const build = parseBuild(firmware);
  const modelName = (i.split('\n')[0] || '').trim();
  let family = 'unknown';
  if (/^tinysa4_/i.test(firmware)) family = 'ultra';
  else if (/^tinysa_v/i.test(firmware)) family = 'basic';
  else if (/ultra/i.test(modelName)) family = 'ultra';
  else if (/^tinysa\b/i.test(modelName)) family = 'basic';
  let board = 'unknown';
  const infoBoard = /\b(ZS\d{3})\b/i.exec(modelName);
  if (infoBoard) board = infoBoard[1].toUpperCase();
  else if (family === 'ultra') { for (const [p, b] of ULTRA_BOARD_PREFIXES) if (hw.startsWith(p)) { board = b; break; } }
  else if (family === 'basic') board = 'ZS304';
  let key = 'TINYSA_GENERIC';
  if (family === 'basic') key = 'TINYSA_BASIC';
  else if (board === 'ZS407') key = 'TINYSA_ULTRA_PLUS';
  else if (board === 'ZS406') key = 'TINYSA_ULTRA_PLUS_406';
  else if (family === 'ultra') key = 'TINYSA_ULTRA';
  return { key, family, board, build, hw, firmware, modelName };
}

/** Kept for callers that only want the model key. */
export function detectModel(version, info) { return identifyDevice(version, info).key; }
