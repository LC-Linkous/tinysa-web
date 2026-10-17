# Changelog

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
