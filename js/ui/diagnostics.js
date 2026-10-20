// diagnostics.js — collect raw replies + timings for a fixed command set.
// SPDX-License-Identifier: GPL-2.0-only
import { TinySA } from '../device/tinysa.js';
import { detectModel } from '../device/models.js';

export const DIAG_COMMANDS = ['version', 'info', 'deviceid', 'vbat', 'status', 'sweep', 'frequencies',
  'scan 1000000 100000000 11 1', 'scan 1000000 100000000 11 2', 'scan 1000000 100000000 11 3', 'data 0', 'rbw', 'attenuate', 'pause', 'resume',
  // 4.0.0: the query forms whose usage line carries the current value, and the words that changed in 2024-2026 firmware
  'level', 'leveloffset', 'calc', 'spur', 'modulation', 'output', 'mode', 'waitscan 1', 'marker'];

/** Runs the diagnostic set. onProgress(text) gets a running summary. Returns the report object. */
export async function collectDiagnostics(sa, sweepParams, onProgress) {
  const link = sa.link;
  const d = {
    tool: 'tinysa-web', version: '0.4.0', when: new Date().toISOString(), userAgent: navigator.userAgent,
    port: link.info(), modelSelected: sa.model, modelDetected: detectModel(sa.ident.version, sa.ident.info), scale: sa.scale, ident: { ...sa.ident, help: undefined }, commands: [],
  };
  const summary = () => d.commands.map(r => `${r.cmd}\n    ${r.error ? 'ERROR ' + r.error : `${Math.round(r.ms)} ms, ${r.lines ?? r.bytes ?? 0} ${r.bytes != null ? 'bytes' : 'lines'}${r.promptCount != null ? `, ${r.promptCount}×ch>` : ''}${r.parsedOk != null ? (r.parsedOk ? ', parsed OK' : ', PARSE FAILED') : ''}`}`).join('\n');
  for (const cmd of DIAG_COMMANDS) {
    const rec = { cmd }; const t0 = performance.now();
    try {
      const r = await link.command(cmd, { timeoutMs: 8000 });
      rec.ms = +r.ms.toFixed(1); rec.rawLength = r.raw.length;
      rec.raw = r.raw.length > 6000 ? r.raw.slice(0, 3000) + '\n…[truncated]…\n' + r.raw.slice(-2000) : r.raw;
      rec.lines = r.body.split('\n').filter(Boolean).length; rec.promptCount = (r.raw.match(/ch>/g) || []).length;
    } catch (e) { rec.error = e.message; rec.ms = +(performance.now() - t0).toFixed(1); }
    d.commands.push(rec); onProgress(summary());
  }
  const { start, stop, pts } = sweepParams;
  // full text scan at the page's current settings
  {
    const rec = { cmd: `scan ${start} ${stop} ${pts} 3` };
    try {
      const r = await link.command(rec.cmd, { timeoutMs: 30000 });
      rec.ms = +r.ms.toFixed(1); rec.lines = r.body.split('\n').filter(Boolean).length; rec.promptCount = (r.raw.match(/ch>/g) || []).length;
      rec.parsedOk = !!TinySA.parseScan(r.body, pts); rec.firstLines = r.body.split('\n').slice(0, 5); rec.lastLines = r.body.split('\n').slice(-3);
      rec.colonGlitches = (r.body.match(/:\.0/g) || []).length;
    } catch (e) { rec.error = e.message; }
    d.commands.push(rec); onProgress(summary());
  }
  // small binary scan: records the frame bytes so the framing can be checked offline
  {
    const n = 15, rec = { cmd: `scanraw ${start} ${stop} ${n} 1` };
    try {
      const r = await link.commandBinary(rec.cmd, 3 * n + 2, { timeoutMs: 15000 });
      rec.ms = +r.ms.toFixed(1); rec.bytes = r.payload.length;
      rec.hex = Array.from(r.payload, b => b.toString(16).padStart(2, '0')).join(' ');
      rec.parsedOk = r.payload[0] === 0x7b && r.payload[r.payload.length - 1] === 0x7d;
      rec.dbm = []; for (let i = 0; i < n; i++) rec.dbm.push(+((r.payload[2 + 3 * i] | (r.payload[3 + 3 * i] << 8)) / 32 - sa.scale).toFixed(2));
    } catch (e) { rec.error = e.message; }
    d.commands.push(rec);
  }
  try { await link.command('resume', { timeoutMs: 3000 }); } catch {}
  onProgress(summary() + '\n\nDone. Download the JSON and attach it to an issue.');
  return d;
}
