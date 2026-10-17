# The tinySA console as this page uses it

The tinySA's USB CDC port is a text shell. The page sends one command per
line and reads until the prompt. Everything below is what `js/device/` relies
on; where the source is a real capture it says so.

## Framing

- Commands end with `\r\n`. The device **echoes the command**, prints the reply
  (lines end with `\r\n`), then the prompt **`ch>`** — once, with no trailing
  space or newline. (Captured: `b'deviceid\r\ndeviceid 0\r\nch>'`.) The
  NanoVNA-F prints the prompt twice with a trailing space; `shell-link.js`
  handles both, which is why it is shared between the two tools.
- Replies arrive in chunks of arbitrary size; the parser accumulates until the
  right-trimmed buffer ends with the prompt, then waits a short settle for
  stragglers and drains.
- The echo and prompt are stripped before the body is parsed
  (`ShellLink.strip`), matching `clean_return()` in `tsapython/core.py`.
- **No error signalling.** A rejected command prints a `usage:` line or a short
  complaint and then the prompt, exactly like success. `looksLikeError()` in
  `tinysa.js` pattern-matches the first line (`usage:`, `invalid`, `unknown`,
  `error`, `out of range`, `cmd?`) and the API methods throw on a match.

## Commands used

| Command | Reply (captured on an Ultra, fw `tinySA4_v1.4-143-g864bb27`) | Used for |
|---|---|---|
| `version` | `tinySA4_v1.4-143-g864bb27\r\nHW Version:V0.4.5.1.1 ` | identity, model detection (`tinySA4` = Ultra) |
| `info` | 11 lines, first is `tinySA ULTRA` | model name in the status line |
| `deviceid` | `deviceid 0` | diagnostics |
| `vbat` | `4154 mV` | Device tools |
| `status` | `Resumed` / `Paused` | Device tools |
| `sweep` | `start stop points` | remember the device's own sweep, "Use device sweep" |
| `sweep {start} {stop} [pts]`, `sweep start\|stop\|center\|span\|cw {Hz}` | nothing | restore the device sweep on disconnect |
| `frequencies` | one integer Hz per line (450 lines on the captured unit) | "Read device trace" |
| `data 0` | one level per line, `%e` format | "Read device trace" |
| `scan {start} {stop} {pts} 3` | `freq level 0.000000000 ` per line — note the trailing space and the third column, which is always zero | single / continuous sweep |
| `scanraw {start} {stop} {pts} 1` | binary, see below | fast sweep |
| `rbw auto\|kHz`, `attenuate auto\|0-31`, `lna on\|off`, `spur on\|off`, `calc …`, `ext_gain dB` | nothing (a `usage:` line if rejected) | Levels section |
| `marker N {Hz}\|peak\|off` | nothing | "Send first 4 to device" |
| `pause`, `resume` | nothing | freeze toggle; after `scanraw` |
| `capture` | 2 bytes × W × H, RGB565 | device screenshot |
| `touchcal`, `touchtest` | text, after the user finishes on the screen | Device tools |
| `caloutput off\|30\|15\|10\|4\|3\|2\|1` | nothing | Device tools |

Outmask for `scan`: 1 = frequencies, 2 = measured level, 4 = stored trace.
With mask 2 or 4 alone the lines are `level 0.000000000 `; with mask 3 the
frequency is prepended. The page always uses 3 so each line is self-describing.

## The `scanraw` frame

```
scanraw 150000000 200000000 5 1\r\n          ← echo
{ x LL HH  x LL HH  x LL HH  x LL HH  x LL HH }ch>
```

`{`, then per point the byte `x` (0x78) followed by a **little-endian uint16**,
then `}` and the prompt with no newline between. Level in dBm is
`value / 32 − scale`, scale 174 on the Ultra and 128 on the Basic
(`tsapython` examples; `SCALE_FACTOR`). Frequencies are not sent — reconstruct
with linspace(start, stop, pts), as the library's examples do.

Sample bytes (0x0ad5 → 2773 / 32 − 174 = −87.3 dBm) can contain `>` (0x3e) and
`}` (0x7d), so the frame **must be read by length**, not by scanning for a
terminator; `shell-link.js`'s `commandBinary` does exactly that (3·pts + 2
bytes after the echo). The library's `get_binary_return()` has the same note.

The device returns exactly one frame per `scanraw` call even with the
"continuous" bit in the last argument; continuous acquisition is repeated
calls. The device's own screen does not update while `scanraw` is in use —
the page sends `resume` after a single raw sweep and when continuous stops.

## Level formatting glitch

Some firmware builds (Jan 2024) print a level as `-:.000000e+01` or
`:.000000e+01`. `:` is ASCII 0x3a, one past `9`: a single digit slot
overflowed and "10" rendered as ":". Both signed and unsigned forms occur.
The page replaces the negative form with `-10.0` first, then the bare form
with `10.0`, exactly as `plotting_waterfall_static.py` does, and counts the
occurrences in the diagnostic sample (`colonGlitches`). Those points sit near
−10 dBm; filter them yourself if they matter.

## Model envelopes (`models.js`)

| Key | Points | Scale | Screen | RBW list (kHz) |
|---|---|---|---|---|
| `TINYSA_BASIC` | 3–290 | 128 | 320×240 | 3 … 600 |
| `TINYSA_ULTRA` | 3–450 | 174 | 480×320 | 0.2 … 850 |
| `TINYSA_ULTRA_PLUS` | 3–450 | 174 | 480×320 | 0.2 … 850 |

Frequency limits are the page's checking envelope only; the device applies
its own.

## Verified against captured hardware replies

`tsapython/tests/fixtures/captured_responses.py` (Ultra, fw 1.4-143): the
demo device reproduces these byte-for-byte for `deviceid`, `version`, `info`,
`vbat`, `status`, `frequencies`, `scan` with masks 1/2/3/4, and the
`scanraw` 5- and 15-point frames (format, not values).

## Not yet verified on live hardware by this page

- `capture` byte order (assumed big-endian from the library's `">H"` unpack).
- Timing of `scan` at 450 points over USB (demo assumes ~2.5 ms/point).
- Whether `rbw` / `attenuate` / `calc` echo anything on success.
- `marker N {Hz}` acceptance across firmware versions.
- Basic and Ultra+ in general.

Collect a diagnostic sample and open a *Scan problem* issue to add to this list.
