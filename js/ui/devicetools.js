// devicetools.js — maintenance commands that need you at the device: touch
// calibration, touch test, battery and status readback, cal output.
// SPDX-License-Identifier: GPL-2.0-only

export function initDeviceTools(root, getSa, con) {
  const status = root.querySelector('#toolsStatus');
  const buttons = root.querySelectorAll('button');
  const calSel = root.querySelector('#calOutSel');
  async function run(label, fn) {
    const sa = getSa(); if (!sa) return;
    buttons.forEach(b => b.disabled = true); status.textContent = `${label}…`;
    try { const r = await fn(sa); status.textContent = `${label}: ` + (typeof r === 'string' && r ? r : 'done.'); }
    catch (e) { status.textContent = `${label} failed: ${e.message}`; con.err(e.message); }
    finally { buttons.forEach(b => b.disabled = false); }
  }
  root.querySelector('#touchCal').addEventListener('click', () => { if (confirm('Touch calibration runs on the device screen and asks you to tap targets. Continue?')) run('Touch calibration', v => v.touchCal().then(() => 'done — check the device screen')); });
  root.querySelector('#touchTest').addEventListener('click', () => run('Touch test', v => v.touchTest().then(() => 'done')));
  root.querySelector('#vbatRead').addEventListener('click', () => run('Battery', async v => `${await v.vbat()} · ${await v.status()}`));
  root.querySelector('#calOutBtn').addEventListener('click', () => run('Cal output', async v => {
    // the same RF-output gate as the generator (tsapython set_output_allowed): ask once here,
    // because the Generator section with its arming box is hidden in analyzer mode
    if (calSel.value !== 'off' && !v.outputAllowed) {
      if (!window.confirm('caloutput switches an RF reference on at the CAL connector. Is a load, attenuator or the analyzer input connected to it?')) throw new Error('caloutput not sent: RF output not armed');
      v.setOutputAllowed(true);
    }
    await v.calOutput(calSel.value); return calSel.value === 'off' ? 'off' : `${calSel.value} MHz reference on the CAL connector`; }));
  return { setEnabled: on => buttons.forEach(b => b.disabled = !on) };
}
