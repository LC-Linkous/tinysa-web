# Changelog

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
