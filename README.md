# tinySA Web

A browser front end for the tinySA and tinySA Ultra spectrum analyzers. Plug
the analyzer in over USB, open the page in Chrome or Edge, click Connect: live
spectrum in dBm, a rolling waterfall, max/min hold and averaging, markers with
peak search, RBW and attenuation control, recording and CSV export. Nothing to
install.

**Use it:** https://lc-linkous.github.io/tinysa-web/

The page has a *Try without hardware* mode with a simulated tinySA Ultra, so it
can be previewed anywhere.

<p align="center"><img src="media/screenshot.png" alt="tinySA Web in demo mode: docked sidebar with sweep controls on the left, spectrum trace with max hold and four numbered peak markers on the dark plot surface, markers table and device console below" width="900"></p>

This is the browser companion to the
[tinySA_python](https://github.com/LC-Linkous/tinySA_python) library
(`tsapython`): same command set, same model envelopes, same quirks list, no
Python needed. It is also the second tool built on the
[nanovna-web](https://github.com/LC-Linkous/nanovna-web) codebase — see
*Shared with nanovna-web* below for what carried over unchanged.

## How it fits together

The tinySA exposes a text console over USB (`ch>` prompt, one command per
line). Both tools speak that console; they differ only in what is on the other
end of the cable.

```
                           tinySA / tinySA Ultra
                     ┌──────────────────────────┐
                     │  console over USB CDC    │
                     │  ch> scan 0 2e9 450 3    │
                     │  ch> scanraw … · rbw …   │
                     └────────────┬─────────────┘
                                  │  same bytes, same commands
                ┌─────────────────┴─────────────────┐
                │                                   │
        Chrome / Edge                           Python
   ┌────────────────────────┐          ┌────────────────────────┐
   │ tinySA Web             │          │ tinySA_python          │
   │                        │          │                        │
   │ Web Serial API         │          │ pyserial               │
   │   ▼                    │          │   ▼                    │
   │ js/device/             │  mirrors │ tsapython/             │
   │   shell-link.js  ─ ─ ─ ┼ ─ ─ ─ ─ ─┼ ─  core.py (serial)    │
   │   tinysa.js      ─ ─ ─ ┼ ─ ─ ─ ─ ─┼ ─  _commands/*.py      │
   │   models.js      ─ ─ ─ ┼ ─ ─ ─ ─ ─┼ ─  core.py (envelope)  │
   │   ▼                    │          │   ▼                    │
   │ js/plot/  js/ui/       │          │ your script, numpy,    │
   │ live plots, markers,   │          │ matplotlib, automation │
   │ hold, recording        │          │                        │
   └───────────┬────────────┘          └───────────┬────────────┘
               │                                   │
               │        .csv  .json                │
               └──────────────► ◄──────────────────┘
                     files move between the two
```

Reading it top to bottom:

- **The device doesn't know which one it's talking to.** `scan`, `scanraw`,
  `rbw`, `attenuate`, `marker` and the rest are sent as the same strings with
  the same framing rules (echo stripped, single bare `ch>` prompt, trailing
  space on scan lines, no error signalling, the `-:.0` level glitch). Anything
  learned about the protocol on one side goes into the other; `PROTOCOL.md`
  here and the library's notes are kept in step.
- **`js/device/` is a port of the library's device layer**: `sa.scan(start,
  stop, pts)` returns the same frequency/level pairs as `tsa.scan(...)` with
  outmask 3, `sa.scanRaw(...)` decodes the binary frame exactly as
  `plotting_scanraw.py` does (`value / 32 − scale`), and `models.js` carries
  the same point limits and scale factors as `core.py`.
- **Above that layer they diverge on purpose.** The page is for the bench:
  watch the band, hold the peaks, find the carrier, record. The library is for
  scripts: batch sweeps, fixtures, anything that needs numpy.
- **Files are the hand-off.** The page's CSV export uses the two-column
  `Frequency_Hz,Signal_Strength_dBm` layout of `save_scan_csv.py`, so a file
  from either tool loads in the other (the page draws one as an overlay). The
  waterfall matrix CSV is the browser-side twin of
  `plotting_waterfall_static.py`'s data.

Only one of the two can hold the serial port at a time; close the page's
connection (or the Python script) before starting the other.

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│ tinySA Web       [Connect] [Demo]  Model ▾   ● status         │
├────────────┬─────────────────────────────────────────────────┤
│ Sweep      │  Spectrum Waterfall   Max Min Avg  Hold  Clear  │
│  start/stop│                                                 │
│  or ctr/spn│                    plot                         │
│  points    │                                                 │
│  scan /raw │                                                 │
│  [Single]  │                                                 │
│  [Contin.] │                                                 │
│ ────────── ├─────────────────────────────────────────────────┤
│ Levels     │  Markers [peak] [top 4] [send to device]        │
│  rbw atten │  # freq level max Δlevel Δfreq                  │
│  lna spur  ├─────────────────────────────────────────────────┤
│  calc gain │  Console ▲ (drag to resize)   Log ▾ [⤓][copy]   │
│ ────────── │  > version                                      │
│ Recording  │  tinySA4_v1.4-143-g864bb27                      │
│ Export     │  > scan 1000000 960000000 450 3                 │
│ Session    │  … 450 lines (1420 ms)                          │
│ Diagnostics│  ┌──────────────────────────────────┐ [Send]    │
│ Device     │  │ type a command                   │           │
│  tools     │                                                 │
│ Settings   │                                                 │
└────────────┴─────────────────────────────────────────────────┘
```

The sidebar is an accordion — click a header to open it, click again to
collapse; the choice is remembered. Drag its right edge to resize it
(double-click the edge to reset). The markers table sits between the plot and
the console so it has the full width. On narrow screens the sidebar stacks
above the plot.

## What it does (v0.1)

- **Sweep** — start/stop or center/span in MHz, points by model maximum /
  quick / custom, single or continuous. Two acquisition paths: `scan` (text,
  frequency + level per line, the device screen keeps updating) or `scanraw`
  (binary, about 3× faster, the device screen freezes until the page sends
  `resume`, which it does after a single sweep and when continuous stops).
- **Views** — spectrum (dBm vs frequency) and waterfall (rolling level
  history, colour range = the level axis).
- **Trace math on the page** — max hold, min hold, power average over the
  last N sweeps (depth in Settings), and *Hold* to freeze a copy for
  comparison. These never touch the device. The device's own `calc` modes are
  in the Levels section if you want them applied before the data leaves it.
- **Markers** — click to place up to six; each shows frequency, level, the
  max-hold level, and Δ level / Δ frequency from marker 1. *Mark peak* finds
  the highest point; *Mark top 4 peaks* finds the four highest local maxima
  at least 10 dB over the sweep median; *Send first 4 to device* writes them
  to the instrument's own markers by frequency (`marker N {Hz}`).
- **Levels** — RBW (model-specific list, or auto), attenuation, LNA (Ultra),
  spur removal, the device's trace math (`calc`), external gain/loss
  (`ext_gain`). Sent as you change them; the console has no query form for
  these, so the page shows what it last sent.
- **Device readback** — *Use device sweep* copies the instrument's own
  start/stop/points into the page (`sweep`); *Read device trace* shows what's
  on its screen without starting a new scan (`frequencies`, `data 0`).
- **Recording** — log every sweep with a timestamp while recording is on;
  save as a waterfall matrix CSV (the plot as data), a long sweep log CSV, or
  JSON.
- **Export** — CSV (`Frequency_Hz,Signal_Strength_dBm`), plot PNG, and a
  screenshot of the device's own screen (`capture`, 480×320 on the Ultra,
  320×240 on the Basic).
- **Session & compare** — save/load the whole page state as JSON; load a
  two-column CSV as a dotted overlay under the live trace.
- **Diagnostics** — one button runs a fixed set of commands, records raw
  replies and timings (plus one small `scanraw` frame as hex), and downloads
  a JSON to attach to an issue. This is how the page gets validated against
  hardware it hasn't seen yet.
- **Device tools** — battery and status readback, touch calibration, touch
  test, and the calibration-output reference signal (`caloutput`).
- **Console** — the raw serial exchange with a resizable drawer, command
  history (↑ ↓), long replies collapsed, copy button, and a log download
  (commands only, or commands + replies, timestamped).
- **Settings** — dark (default) or light theme; trace colours as the
  instrument convention (yellow trace, magenta max, cyan min) or
  blue/amber/green; reference level and floor (the level axis and the
  waterfall colour range); waterfall palette (Viridis, Inferno, Turbo, Classic
  SDR, Grey); average depth; a `scanraw` scale-factor override for firmware
  the page hasn't seen; overlay on/off; resume-on-disconnect; raw-byte echo
  for debugging framing. All remembered in the browser.

Not yet: signal-generator panel (`output`, `level`, `modulation`), zero-span
level meter (`sweep cw`), SD-card browser (`sd_list` / `sd_read`), trigger
setup. Each is a sidebar section away; the device layer already has room for
them.

## Supported hardware

Built for the tinySA Ultra (what the maintainer owns and what the library's
captured responses come from). The Basic, Ultra+ and a generic envelope are
selectable from the Model dropdown; the Basic's limits come from the tinySA
wiki and are untested. Detection reads `version` (`tinySA4_…` is an Ultra)
and the first line of `info`.

Chrome or Edge is required for the USB link — they implement
[Web Serial](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API).
Firefox and Safari can only use the demo.

The tinySA and the NanoVNA-F share the same USB VID:PID, so the port chooser
shows both; the page checks the reply to `version` and refuses a device that
doesn't answer like a tinySA.

## Shared with nanovna-web

This repo was made by copying [nanovna-web](https://github.com/LC-Linkous/nanovna-web)
and replacing the instrument-specific parts. The point was to find out how
much of that codebase is actually generic. Result, by file:

| Unchanged (byte-identical) | Instrument-specific (rewritten) |
|---|---|
| `js/device/shell-link.js` — console framing | `js/device/tinysa.js`, `models.js`, `demo-link.js` |
| `js/device/serial-link.js` — Web Serial transport | `js/sa.js` (was `rf.js`) — dBm math, peak finding, holds |
| `js/plot/common.js`, `js/plot/palettes.js` | `js/plot/spectrum.js`, `waterfall.js` (was `rect.js`, `smith.js`, `waterfall.js`) |
| `js/ui/sidebar.js`, `js/ui/console.js` | `js/ui/settings.js`, `recorder.js`, `export.js`, `session.js`, `diagnostics.js`, `devicetools.js` |
| `css/layout.css`, `css/components.css` | `js/ui/levels.js` (new; replaces `calibration.js`, `cw.js`) |
| `.github/workflows/pages.yml`, `LICENSE`, `CODE_OF_CONDUCT.md` | `css/theme.css` — only the trace-colour block differs |
| | `index.html`, `js/main.js` |

So the transport, framing, console drawer, sidebar, palettes, layout and
component styles are a reusable kit; everything that knows what the numbers
mean is per instrument. One shared file changed during the port
(`shell-link.js` gained a `quiet` option on `commandBinary`) and the change
was applied to both repos the same day — the rule is that the "unchanged"
column stays identical, so a diff between the two repos is the list of
instrument-specific code.

## Code layout

No build step; native ES modules.

```
index.html                 markup only
css/
  theme.css                colour tokens: dark/light themes, trace colour schemes
  layout.css               top bar, docked sidebar, plot, console drawer
  components.css           buttons, inputs, tables
js/
  main.js                  app state + wiring
  sa.js                    pure math: formatting, peak search, hold/average helpers
  device/                  ← the reusable "library" layer
    shell-link.js          console framing (ch> prompt, echo, binary)
    serial-link.js         Web Serial transport
    demo-link.js           simulated tinySA Ultra, same byte stream
    models.js              per-model envelopes, detectModel()
    tinysa.js              TinySA class — method names mirror tsapython
  plot/
    spectrum.js  waterfall.js  palettes.js  common.js
  ui/
    sidebar.js  console.js  settings.js  diagnostics.js  export.js
    levels.js  session.js  devicetools.js  recorder.js
```

`js/device/` is the part another tool would reuse: `main.js` calls
`sa.scan(start, stop, pts)` and gets typed arrays back; it never sees `ch>`.

## Running locally

Module scripts don't load from `file://` in Chrome, so serve the folder:

```sh
python -m http.server 8000
# then open http://localhost:8000/
```

Web Serial works on `localhost`, so a real device can be used this way.

## Validating against a real device

1. Connect, run a single `scan`. If the plot looks wrong or the sweep fails,
   open *Diagnostics* → **Collect sample** and attach the JSON to an issue
   using the *Scan problem* template.
2. Switch to `scanraw` and sweep again. The two traces should sit on top of
   each other; if the binary one is offset by a constant, the scale factor is
   wrong for your firmware — the diagnostic JSON has both, and Settings has an
   override.
3. Compare the page's trace with the device's screen (*Export → Device
   screenshot* pulls that over USB too).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the issue templates. Please read
the short [code of conduct](CODE_OF_CONDUCT.md).

## License

GPL-2.0 — see [LICENSE](LICENSE). Same as the tinySA_python library.

tinySA Web is not affiliated with or endorsed by the tinySA project or its
makers. Refer to the tinySA wiki for anything about the device itself.
