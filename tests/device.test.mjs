// Device-layer tests: TinySA over the DemoLink, which produces the real byte
// stream (echo, body, prompt, chunked). Run with:  node --test 'tests/**/*.test.mjs'
// SPDX-License-Identifier: GPL-2.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DemoLink } from '../js/device/demo-link.js';
import { TinySA, classifyReply, STATUS, DeviceError, MAX_COMMAND_LENGTH } from '../js/device/tinysa.js';
import { identifyDevice, parseBuild, buildAtLeast, FIRMWARE_FLOOR } from '../js/device/models.js';

async function connected() { const sa = new TinySA(new DemoLink()); sa.onWarning = () => {}; await sa.identify(); return sa; }
const rejects = (p, status) => p.then(() => assert.fail('expected a DeviceError'), e => { assert.ok(e instanceof DeviceError, e.message); if (status) assert.equal(e.status, status); });

test('identify: board, build, help list', async () => {
  const sa = await connected();
  assert.equal(sa.model, 'TINYSA_ULTRA');
  assert.equal(sa.ident.board, 'ZS405');
  assert.deepEqual(sa.ident.build, [1, 4, 252]);
  assert.ok(sa.has('waitscan') && sa.has('hop') && !sa.has('nosuch'));
  assert.ok(sa.ident.label.includes('tinySA ULTRA ZS405'));
});

test('identifyDevice from captured replies', () => {
  const u143 = identifyDevice('tinySA4_v1.4-143-g864bb27\nHW Version:V0.4.5.1.1 ', 'tinySA ULTRA\n2019-2024 Copyright');
  assert.deepEqual([u143.key, u143.board, u143.build], ['TINYSA_ULTRA', 'ZS405', [1, 4, 143]]);
  const p407 = identifyDevice('tinySA4_v1.4-244-g650f538\nHW Version:V0.5.4 max2871', 'tinySA ULTRA+ ZS407');
  assert.deepEqual([p407.key, p407.board], ['TINYSA_ULTRA_PLUS', 'ZS407']);
  const b = identifyDevice('tinySA_v1.4-200-gabcdef', 'tinySA\n2019 Copyright');
  assert.deepEqual([b.key, b.board, b.family], ['TINYSA_BASIC', 'ZS304', 'basic']);
  assert.equal(identifyDevice('NanoVNA-F_V2', 'NanoVNA').key, 'TINYSA_GENERIC');
  assert.equal(parseBuild('tinySA4_v1.4-252-g2b4aa51')[2], 252);
  assert.ok(buildAtLeast([1, 4, 252], FIRMWARE_FLOOR) && !buildAtLeast([1, 4, 143], FIRMWARE_FLOOR));
});

test('classifyReply mirrors tsapython', () => {
  assert.equal(classifyReply('rbw 30', '').status, STATUS.OK);
  assert.equal(classifyReply('rbw 999', 'usage: rbw 0.2..850|auto').status, STATUS.USAGE);
  assert.equal(classifyReply('rbw', 'usage: rbw 0.2..850|auto\n30kHz').status, STATUS.OK);        // bare command = query
  assert.equal(classifyReply('nosuch 1', 'nosuch?').status, STATUS.UNKNOWN);
  assert.equal(classifyReply('pause', 'Command timeout').status, STATUS.REFUSED);
  assert.equal(classifyReply('save 9', 'save {id}').status, STATUS.USAGE);
});

test('device rejection throws with status; lastStatus tells blocked from usage', async () => {
  const sa = await connected();
  await rejects(sa.rbw(9999), STATUS.USAGE);
  assert.equal(sa.lastStatus, STATUS.USAGE);
  await rejects(sa.marker(9, 'peak'), STATUS.BLOCKED);                 // Ultra has 8
  assert.equal(sa.lastStatus, STATUS.BLOCKED);
  await rejects(sa.mode('high', 'output'), STATUS.BLOCKED);             // Basic only
  await rejects(sa.raw('x'.repeat(MAX_COMMAND_LENGTH + 1)), STATUS.BLOCKED);
  const r = await sa.raw('text ' + 'A'.repeat(MAX_COMMAND_LENGTH - 5)); assert.equal(r.status, STATUS.UNKNOWN); // demo lacks text; the length was fine
});

test('output gate', async () => {
  const sa = await connected();
  await rejects(sa.output('on'), STATUS.BLOCKED);
  await rejects(sa.calOutput(30), STATUS.BLOCKED);
  await sa.output('off');                                               // always allowed
  sa.setOutputAllowed(true);
  await sa.setupGenerator({ freqHz: 10e6, levelDbm: -30 });
  await sa.output('on');
  assert.equal(sa.link.outputOn, true);
  await sa.output('off');
});

test('setupGenerator sequence and demo state', async () => {
  const sa = await connected(); sa.setOutputAllowed(true);
  const sent = []; const w = sa.link._write.bind(sa.link); sa.link._write = s => { sent.push(s.trim()); return w(s); };
  await sa.setupGenerator({ freqHz: 433.92e6, levelDbm: -20, modulation: 'am', modulationRateHz: 1000, depthPct: 50 });
  assert.deepEqual(sent, ['output off', 'mode low output', 'output off', 'pause', 'level -20', 'sweep cw 433920000', 'modulation am', 'modulation freq 1000', 'modulation depth 50', 'resume']);
  assert.equal(sa.link.genLevel, -20); assert.equal(sa.link.genFreq, 433.92e6); assert.equal(sa.link.modulation, 'am');
  assert.equal(sa.paused, false);
});

test('setupGenerator stops at a refused step and resumes', async () => {
  const sa = await connected(); sa.setOutputAllowed(true);
  const sent = []; const w = sa.link._write.bind(sa.link); sa.link._write = s => { sent.push(s.trim()); return w(s); };
  await rejects(sa.setupGenerator({ freqHz: 10e6, levelDbm: 5 }), STATUS.BLOCKED);   // -76..-6 on the Ultra
  assert.equal(sent[sent.length - 1], 'resume');
  assert.ok(!sent.includes('sweep cw 10000000'));
  assert.equal(sa.lastStatus, STATUS.BLOCKED);
});

test('legacy modulation keywords are translated; Basic words refused on the Ultra', async () => {
  const sa = await connected(); sa.setOutputAllowed(true);
  await sa.setupGenerator({ freqHz: 10e6, levelDbm: -30 });
  const sent = []; const w = sa.link._write.bind(sa.link); sa.link._write = s => { sent.push(s.trim()); return w(s); };
  await sa.setGenerator({ modulation: 'AM_1kHz' });
  assert.deepEqual(sent, ['pause', 'modulation am', 'modulation freq 1000', 'resume']);
  await rejects(sa.modulation('NFM'), STATUS.BLOCKED);
});

test('settle after output/modulation keeps the next command out of the firmware window', async () => {
  const sa = await connected(); sa.setOutputAllowed(true);
  await sa.setupGenerator({ freqHz: 10e6, levelDbm: -30 });
  await sa.output('on');
  const t0 = Date.now();
  await sa.setGenerator({ levelDbm: -40 });                // pause right after output on: must not hit "Command timeout"
  assert.ok(Date.now() - t0 < DemoLink.COMMAND_TIMEOUT_MS, 'took the Command timeout path');
  assert.equal(sa.link.genLevel, -40);
});

test('Command timeout is recognised and an idempotent setter is retried', async () => {
  const sa = await connected(); sa.setOutputAllowed(true);
  await sa.setupGenerator({ freqHz: 10e6, levelDbm: -30 });
  sa.link.lastImmediateSetter = Date.now();                // pretend a setter just ran, no settle
  const warnings = []; sa.onWarning = t => warnings.push(t);
  const t0 = Date.now();
  await sa.pause();                                        // first attempt dropped (3 s), retry succeeds
  assert.ok(Date.now() - t0 >= DemoLink.COMMAND_TIMEOUT_MS - 50);
  assert.equal(sa.paused, true);
  assert.equal(warnings.length, 1);
  await sa.resume();
});

test('scan and scanRaw still agree; unbuf 2 refused', async () => {
  const sa = await connected();
  const a = await sa.scan(100e6, 200e6, 21), b = await sa.scanRaw(100e6, 200e6, 21);
  assert.equal(a.pts, 21); assert.equal(b.pts, 21);
  assert.ok(Math.abs(a.dbm[10] - b.dbm[10]) < 6);
  await rejects(sa.scanRaw(1e6, 2e6, 5, { unbuf: 2 }), STATUS.BLOCKED);
});
