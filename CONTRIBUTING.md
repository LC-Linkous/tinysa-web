# Contributing to tinySA Web

Thanks for helping. Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) first.

This page talks to a device whose firmware we don't control, so most useful
contributions are **evidence from hardware**: a diagnostic sample from a model
or firmware version the page hasn't seen, a quirk written up in `PROTOCOL.md`,
or a fix to the driver with the sample that motivated it.

## Ways to contribute

- **A scan that fails or looks wrong** — use the *Scan problem* template and
  attach the JSON from *Collect diagnostic sample*. That file is the whole
  point of the diagnostics button; one of them is worth more than a paragraph
  of description.
- **A device the page hasn't been tested with** — same template. If it works,
  say so too: "works on a Basic with firmware X" is useful and goes in the README.
- **Bugs in the page itself** — *Bug report* template.
- **Ideas** — *Feature request* template. Views, readouts, export formats,
  levels and markers.
- **Docs** — README, PROTOCOL.md. No hardware needed.
- **Code** — see below.

## The shape of the code

Native ES modules, no build step. The README has the directory map; the
short version:

- `js/device/` — the library layer. `shell-link.js` is the console protocol
  (framing, prompt detection, echo stripping, no-prompt and binary paths);
  `serial-link.js` and `demo-link.js` are transports; `models.js` holds the
  per-model envelopes mirrored from `tsapython core.py`; `tinysa.js`
  is the `TinySA` class whose method names match the Python library. To add
  a model: an entry in `models.js` and a pattern in `detectModel()`.
- `js/plot/` — one file per view, all drawing straight to the canvas.
  `palettes.js` holds the waterfall colour maps.
- `js/ui/` — one file per sidebar section or drawer.
- `js/main.js` — state and wiring only. If you find yourself adding logic
  here, it probably belongs in one of the folders above.
- `css/theme.css` — every colour. The trace colours `--trace` / `--maxhold` / `--minhold` / `--avg` are
  the only colours data may use.

Files listed as *unchanged* in the README's *Shared with nanovna-web* table
must stay byte-identical to their copies in that repo; a fix to one of them
goes to both repos in the same change.

A fix to the driver should be reproducible through `DemoLink` if at all
possible: if a real device does something odd, teach the demo to do it too, so
the fix stays tested without hardware.

## Development setup

No build step, but module scripts won't load from `file://`, so serve the
folder and open it over http:

```sh
python -m http.server 8000      # then http://localhost:8000/
```

Web Serial works on `localhost`. No frameworks, no bundler, no CDN scripts;
the page must still work with the Google Fonts blocked.

## Testing before a PR

| Change touches… | Test |
|---|---|
| `js/device/` | `node --test 'tests/**/*.test.mjs'` (the device layer over the demo device), the demo walkthrough, **and** a real device: single sweep at max points, continuous for a minute, *Collect diagnostic sample* before and after the change; paste both summaries in the PR. A generator change also needs a load on the RF port and the output on/off, level and modulation steps exercised. |
| Views, markers, math | Demo walkthrough, every view, light and dark. Check a marker's R + jX by hand for one point (Z = Z₀ (1+Γ)/(1−Γ)). |
| Export | Open the CSV in a spreadsheet and the `.s1p` in any Touchstone reader (scikit-rf, tinySA-Saver, a VNA vendor tool). |
| `MODELS` | Numbers come from the tinySA firmware source (`nanovna.h`, `sa_cmd.c`), the same place tsapython's `_profiles.py` reads them; say which file and build, and whether a real unit confirmed them (`verified`). |
| PROTOCOL.md | Mark each claim *verified on &lt;model&gt;* or *unverified*. |

## Style

- Two-space indent; modules export what they need and nothing touches `window`.
- Colours come from the CSS variables at the top. `--trace`, `--maxhold`,
  `--minhold` and `--avg` are the only trace colours; nothing else on the page
  may use them.
- Numbers shown to the user go through `fmtHz` / `toFixed` — no raw floats.
- Copy in sentence case, plain words. The audience is someone with a tinySA on
  the desk, not necessarily someone who has read the firmware.

## Commit and PR conventions

- One logical change per PR; reference the issue it closes.
- Any new device behaviour discovered goes into `PROTOCOL.md` (*Quirks* or
  *Not yet verified*) in the same PR as the code that handles it.
- Add a line to `CHANGELOG.md`.

## License

By contributing, you agree that your contributions are licensed under the
project's **GPL-2.0** license.
