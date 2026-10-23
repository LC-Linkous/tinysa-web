# Changelog

## v0.5.1 — own state, stricter echo

- `<html data-app="tinysa-web">`: the sidebar's open section and width and
  the console's height are stored under this tool's own localStorage keys,
  and console logs download as `tinysa-console-…txt`. Before, the keys were
  `nanovna-web.*`, shared with nanovna-web when both are served from one
  origin (lc-linkous.github.io), so one page's sidebar state leaked into
  the other's.
- Console framing: a command's echo must be a whole line. A substring match
  let a stale `sweeptime` line pass as the echo of `sweep` after a timeout,
  and the leftovers became the reply.
- The kit files are no longer kept byte-identical to nanovna-web.

## v0.5.0 — meter, compare, trigger, SD card

- **Zero-span level meter** as a window view: one frequency read continuously
  (`scanraw` around it, span 20 kHz – 5 MHz), peak / mean / max / min, readings
  per second, a strip of the last 240 readings. Takes the port like a
  continuous sweep and resumes the device screen on stop.
- **Compare** view: live against the held trace, with live − held on a
  right-hand axis, mean Δ and max |Δ|. Hover and markers work in it.
- **Trigger** in Levels: `trigger auto|normal|single` and a level in dBm.
- **SD card** in Device tools (Ultra family): `sd_list` with a pattern,
  download any file with `sd_read` (length-prefixed binary; `err:` replies
  and `sd_read?` are reported, not read as a length).
- **Copy as Python** in Export: a tsapython 4.0.0 script for the current
  sweep and level settings.
- Device layer: `trigger()`, `measureAt()`, `sdList()`, `sdRead()`;
  `shell-link.js` gained a `lengthPrefix` option on `commandBinary` (applied to
  nanovna-web as well). Demo device: a three-file SD card, `trigger`.
- Tests: 14 device-layer tests.

## v0.4.0 — replay and clips

- **Replay**: a slider and Play / speed (0.5–8×) in the Recording section
  scrub through the recording; every window redraws for that sweep, with the
  waterfall and peak history rebuilt from the recording up to that point.
  *Live* returns to the instrument. Sweeps arriving during a replay are still
  recorded. *Load recording JSON* brings a saved recording back.
- **Clip (WebM)**: *Save recording as clip* plays the recording back at the
  chosen speed while the browser's MediaRecorder encodes the windows, one
  frame per sweep; *Record clip of the windows* does the same for the live
  display until stopped. Optional caption bar (range, sweep, time, device).
  VP9 WebM, full colour, no library; typically tens of kB per sweep-frame.
  `js/ui/clip.js` is shared with nanovna-web.

## v0.3.1

- `panes.js` is now the shared module (storage key and default views are
  parameters) and `panes.css`'s grid block is identical to nanovna-web's,
  which gained the same 1 / 2 / 4 windows in its v0.5.0. Two windows are side
  by side on a wide screen (they were stacked).

## v0.3.0 — tsapython 4.0.0 parity

`js/device/` now matches the library's 4.0.0 device layer, from the same
hardware session (tinySA Ultra ZS405, firmware v1.4-252).

- **Identification**: board (ZS304 / ZS405 / ZS406 / ZS407) from `info` or the
  `HW Version` prefix, firmware build parsed, the device's `help` list decides
  which commands are sent (`sa.has()`); a warning below firmware v1.4-182.
- **Device profiles** (`models.js`) from the firmware source: 8 markers on the
  Ultra family, per-model modulation / output / spur / calc words and level
  ranges, Ultra+ ZS406 and ZS407 as separate entries, ranges with and without
  ultra mode.
- **Reply classification**: `classifyReply()` ports the library's
  `classify_reply()`; API methods throw a `DeviceError` with `.status`
  (`usage`, `unknown-command`, `device-refused`, `blocked`, `timeout`) and
  `sa.lastStatus` keeps it. Bare commands are queries, not rejections.
- **Generator mode rewritten for current firmware.** The 2020 modulation
  keywords (`AM_1kHz`, `AM_10Hz`, `NFM`, `WFM`) are gone from the firmware;
  the page sends `modulation off|am|fm` with `freq`, `depth` and `deviation`
  (Ultra family) or `off|am|nfm|wfm|extern` (Basic). Entering the mode uses
  the firmware's order (`output off`, `mode`, `pause`, `level`, `sweep cw`,
  `modulation`, `resume`) with the output off; changes go between `pause` and
  `resume`; the level range follows the model and band. The output button is
  behind an arming checkbox ("a load or attenuator is on the RF port"), the
  same gate as the library's `set_output_allowed(True)`; `caloutput` from
  Device tools asks once.
- **Output-mode firmware race handled**: a 0.4 s settle after `output` /
  `modulation` / `caloutput` / `leveloffset`, `Command timeout` recognised as
  the end of a reply, idempotent setters resent once. PROTOCOL.md has the
  mechanism and the measurements.
- **Reader**: waits for the command's own echo before accepting a prompt
  (stale replies discarded); commands over 47 bytes refused before sending;
  all commands serialised through one queue, so the battery poll can no
  longer interleave with a user command (it did: an `output off` reply could
  carry the `status` reply).
- **Levels**: `calc` words are the current ones (`quasi`, `aver`, `log`, `lin`);
  `spur auto` on the Ultra family.
- **Demo device** simulates a ZS405 on v1.4-252: the board in `info`, the
  v1.4-252 `help` list, current modulation words, `mode [low] input|output`,
  the level reset on a mode change, and the dropped-command race (timeout
  shortened to 3 s so it can be seen).
- **Tests**: `node --test 'tests/**/*.test.mjs'` runs the device layer against the demo
  device's byte stream; a GitHub workflow runs them on push and PR.
- Diagnostics also records the query forms (`level`, `calc`, `modulation`,
  `output`, `mode`, …) and `waitscan`, so a sample says what words a firmware
  accepts.
- `scanraw`'s last argument is a bit field since v1.4-177; the page sends
  0 or 1 only.

## v0.2.0 — windows, generator mode, more readouts

- **Windows**: the plot area is 1, 2 or 4 panes, each showing its own view
  (Spectrum, Waterfall, Peak history, Generator). Layout and views remembered.
- **Peak history** view — peak level and peak frequency over successive
  sweeps, the third panel of tsapython's `plotting_waterfall_realtime.py`.
- **Generator mode** (top-bar tab): puts the device in `mode low|high output`,
  with frequency (`sweep cw`), level, modulation and an output on/off button;
  the Generator pane draws the nominal output as commanded. Switching back to
  Analyzer sends `output off` and `mode … input`. The sidebar shows only the
  sections that apply to the current mode. Fully exercised by the demo device.
- **Smoothing** toggle (median 5 / mean 5, from `filtering_scan_artifacts.py`)
  for the display only; the recording keeps raw data. The `:` glitch count is
  shown per sweep.
- **scanraw scale check** in Diagnostics: runs `scan` and `scanraw` on the same
  range, reports the offset, and can apply the suggested scale factor.
- **Battery and status** in the top bar (`vbat`, `status`, every 30 s).
- **Device markers**: *Ask device for peak* sends `marker 1 peak`, reads the
  device's markers back, draws them as hollow glyphs and compares with the
  page's peak.
- Markers table: peak frequency by parabolic interpolation (marked *), −3 dB
  bandwidth, band power between markers 1 and 2; noise-floor (median) line on
  the spectrum.
- Device tools: read-only calibration state (`freq_corr`, `actual_freq`,
  `zero`, `vbat_offset`).
- Axis tick density adapts to pane width.

## v0.1.0 — first release

- Web Serial driver for the tinySA console, sharing `shell-link.js` with
  nanovna-web unchanged (single bare `ch>` prompt handled by the same parser).
- Model envelopes for tinySA Basic, Ultra, Ultra+ and generic; detection from
  `version` / `info` with manual override.
- `scan` (text, outmask 3) and `scanraw` (binary, by-length frame read,
  `value / 32 − scale`) acquisition, single and continuous. The `-:.0` level
  glitch from Jan-2024 firmware is corrected the way tsapython's examples do.
- Views: spectrum (dBm) and waterfall. Page-side max hold, min hold, power
  average, and a held trace.
- Markers: up to six with level, max-hold level and Δ to marker 1; peak and
  top-4-peaks finders; send to the device's own markers by frequency.
- Levels section: RBW, attenuation, LNA, spur removal, device `calc`,
  external gain.
- Recording (waterfall matrix CSV, sweep log CSV, JSON), CSV export in the
  `save_scan_csv.py` layout, plot PNG, device screenshot, session save/load,
  CSV overlay, diagnostics sample with a hex `scanraw` frame, device tools.
- Demo device (simulated tinySA Ultra) reproducing the captured replies in
  tsapython's test fixtures.

Built against the demo device and tsapython's captured responses. See *Not
yet verified on live hardware* in PROTOCOL.md.
