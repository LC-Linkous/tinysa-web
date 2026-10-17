// levels.js — the Levels sidebar section: RBW, attenuation, LNA, spur
// removal, the device's own trace math, external gain. Each control sends its
// command when changed and reports on a status line. Nothing is read back —
// the console has no query form for these — so the page shows what it last sent.
// SPDX-License-Identifier: GPL-2.0-only

export function initLevels(root, getSa, con) {
  const status = root.querySelector('#levelsStatus');
  const rbw = root.querySelector('#rbwSel'), att = root.querySelector('#attSel'), lna = root.querySelector('#lnaChk'), spur = root.querySelector('#spurChk'), calc = root.querySelector('#calcSel'), gain = root.querySelector('#extGain'), gainBtn = root.querySelector('#extGainBtn');
  const controls = root.querySelectorAll('select, input, button');
  async function send(label, fn) {
    const sa = getSa(); if (!sa) return;
    controls.forEach(c => c.disabled = true); status.textContent = `${label}…`; status.className = 'hint';
    try { await fn(sa); status.textContent = `${label} sent.`; }
    catch (e) { status.textContent = `${label}: ${e.message}`; status.className = 'hint err'; con.err(e.message); }
    finally { setEnabled(true); }
  }
  function fillRbw(env) {
    rbw.innerHTML = '<option value="auto">auto</option>' + env.rbw.map(k => `<option value="${k}">${k} kHz</option>`).join('');
    lna.closest('label').hidden = !env.lna;
  }
  rbw.addEventListener('change', () => send(`rbw ${rbw.value}`, sa => sa.rbw(rbw.value)));
  att.addEventListener('change', () => send(`attenuate ${att.value}`, sa => sa.attenuate(att.value)));
  lna.addEventListener('change', () => send(`lna ${lna.checked ? 'on' : 'off'}`, sa => sa.lna(lna.checked)));
  spur.addEventListener('change', () => send(`spur ${spur.checked ? 'on' : 'off'}`, sa => sa.spur(spur.checked)));
  calc.addEventListener('change', () => send(`calc ${calc.value}`, sa => sa.calc(calc.value)));
  gainBtn.addEventListener('click', () => send(`ext_gain ${gain.value}`, sa => sa.extGain(parseFloat(gain.value) || 0)));
  function setEnabled(on) { const sa = getSa(); controls.forEach(c => c.disabled = !on); if (on && sa) lna.disabled = !sa.env.lna; }
  setEnabled(false);
  return { setEnabled, fillRbw, reset() { rbw.value = 'auto'; att.value = 'auto'; lna.checked = false; spur.checked = false; calc.value = 'off'; status.textContent = ''; } };
}
