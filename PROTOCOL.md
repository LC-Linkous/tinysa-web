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
- **No error signalling, but a readable pattern.** A rejected command prints a
  `usage:` line (for an argument the firmware will not take), `name?` (for a
  command this firmware does not have), or one of a few refusals (`usb disk
  mode active`, `Command timeout`, `frequency range is invalid`, ...), then the
  prompt, exactly like success. `classifyReply()` in `tinysa.js` is a port of
  tsapython's `classify_reply()`: it returns `ok`, `usage`, `unknown-command`
  or `device-refused`, the API methods throw a `DeviceError` carrying that
  status, and `sa.lastStatus` keeps it. A usage line counts as a rejection only
  when the command carried an argument: a bare `rbw` or `level` is a query, and
  the usage line with the current value **is** its answer.
- **The command line is 48 bytes.** Characters past the 47th are neither stored
  nor echoed, so the device runs a truncated command and the echo never
  matches. The page refuses longer commands before sending (`MAX_COMMAND_LENGTH`).
- **Stale replies.** When a command times out and its reply arrives later, the
  naive reader hands that reply to the next command. The page's reader waits for
  the new command's own echo before it accepts a prompt, and discards what came
  before it (`requireEcho` in `shell-link.js`).
- **`Command timeout`** (firmware v1.4-222 and later) is printed, with **no
  prompt**, when a command that runs between sweeps is not picked up within
  20 s. It ends the reply (`terminators` in `shell-link.js`); see *Output mode*.

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
| `rbw auto\|kHz`, `attenuate auto\|0-31`, `lna on\|off`, `spur off\|on\|auto`, `calc off\|minh\|maxh\|maxd\|aver4\|aver16\|aver\|quasi\|log\|lin`, `ext_gain dB` | nothing (a `usage:` line if rejected). `quasip` became `quasi`; `spur auto`, `calc log\|lin` are Ultra family only | Levels section |
| `marker N {Hz}\|peak\|off` | nothing | "Send first 4 to device", "Ask device for peak" |
| `marker` (no arguments) | one line per enabled marker — **format assumed**: `id index frequency level` | device markers on the plot |
| `mode [low] input\|output` (Ultra family) / `mode low\|high input\|output` (Basic), `sweep cw {Hz}`, `level dBm`, `modulation off\|am\|fm` (Ultra) / `off\|am\|nfm\|wfm\|extern` (Basic), `modulation freq\|depth\|deviation {n}`, `output on\|off[\|normal\|mixer]`, `mode … input` | nothing (a `usage:` line if rejected). The 2020 keywords `AM_1kHz`, `AM_10Hz`, `NFM`, `WFM` are gone | Generator mode |
| `waitscan [n]` | nothing; returns after n sweeps (v1.4-216+) | available to callers of `sa.waitscan()` |
| `trigger auto\|normal\|single`, `trigger {dBm}` | nothing (`trigger {value}` / `trigger {auto\|normal\|single}` usage lines, without the `usage:` prefix, if rejected). A level also selects normal | Levels → Trigger |
| `sd_list [pattern]` | `NAME SIZE` per line (the card's directory order); `err: (n)` if no card | Device tools → SD card |
| `sd_read {name}` | binary: a 4-byte little-endian length, then that many bytes, then the prompt; `err: (4) no file` as text instead | Device tools → SD card (download) |
| `help` | `commands: …` and `Other commands: …` | which commands this firmware has (`sa.has(cmd)`) |
| `freq_corr`, `actual_freq`, `zero`, `vbat_offset` | one line each (`0 ppb`, `30000000`, `174dBm`, `300` on the demo) | Device tools → Calibration state |
| `pause`, `resume` | nothing | freeze toggle; after `scanraw` |
| `capture` | 2 bytes × W × H, RGB565 | device screenshot |
| `touchcal`, `touchtest` | text, after the user finishes on the screen | Device tools |
| `caloutput off\|30\|15\|10\|4\|3\|2\|1` | nothing | Device tools |

Outmask for `scan`: 1 = frequencies, 2 = measured level, 4 = stored trace.
With mask 2 or 4 alone the lines are `level 0.000000000 `; with mask 3 the
frequency is prepended. The page always uses 3 so each line is self-describing.

## Output mode (signal generator)

Learned on a ZS405 running v1.4-252 while bringing up tsapython 4.0.0, with the
mechanism confirmed in the firmware source (`main.c`, `sa_core.c`):

- **Two kinds of command.** `output`, `modulation`, `caloutput` and
  `leveloffset` run in the shell thread and answer at once. `pause`, `resume`,
  `level`, `sweep`, `mode`, `rbw`, `attenuate`, `calc`, `spur`, `sweeptime`,
  `marker`, `trace` and most others are handed to the sweep thread and run
  *between sweeps*. In input mode a sweep ends every few hundred ms. In output
  mode the generator loop runs until something interrupts it, which a queued
  command does.
- **The dropped-command race.** A shell-thread setter leaves a redraw request
  that the sweep thread clears about 200 ms later. A between-sweeps command
  queued inside that window loses its wake-up: the generator loop never looks
  at it, and 20 s later the shell prints `Command timeout` with no prompt. The
  command was never executed. Measured on the ZS405: a command 150–160 ms after
  `output`/`modulation` is dropped, 230 ms after it is served.
- **What the page does.** Waits 400 ms after those four setters
  (`SETTLE_AFTER_IMMEDIATE_SETTER_MS`); treats `Command timeout` as the end of a
  reply; resends a command once when it is an idempotent setter (`pause`,
  `resume`, `level`, `sweep`, `mode`, `rbw`, ...), never `menu`, `touchcal`,
  `restart` or `save`. `setupGenerator()` / `setGenerator()` also wrap settings
  in `pause` … `resume`, so they run immediately instead of waiting for a
  generator sweep to end.
- **Order of settings.** `output off` → `mode … output` → `pause` → `level` →
  `sweep cw` → `modulation` → `resume`, output still off; `output on` is a
  separate, explicit step behind the arming box. The firmware resets the level
  to maximum on every mode change, which is why `level` comes after `mode`.
- **Level ranges.** Low output −76 … −6 dBm on every model; high output
  −38 … +13 dBm, Basic only (the Ultra family has one band:
  `mode [low] input|output`).
- The demo device reproduces the race with the timeout shortened to 3 s.

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

The last argument is a bit field since firmware v1.4-177: 1 = unbuffered, 2 =
repeat (the device streams frames until `pause`). The page sends 0 or 1 only
and reads one frame per call; continuous acquisition is repeated calls. The device's own screen does not update while `scanraw` is in use —
the page sends `resume` after a single raw sweep and when continuous stops.

## Level formatting glitch

Some firmware builds (Jan 2024) print a level as `-:.000000e+01` or
`:.000000e+01`. `:` is ASCII 0x3a, one past `9`: a single digit slot
overflowed and "10" rendered as ":". Both signed and unsigned forms occur.
The page replaces the negative form with `-10.0` first, then the bare form
with `10.0`, exactly as `plotting_waterfall_static.py` does, and counts the
occurrences in the diagnostic sample (`colonGlitches`). Those points sit near
−10 dBm; filter them yourself if they matter.

## Identification and model envelopes (`models.js`)

`identifyDevice(version, info)` is a port of tsapython's `identify_device()`:

- family: `tinySA4_…` in `version` is the Ultra family, `tinySA_v…` the Basic;
- board: `info` prints it since v1.4-190 (`tinySA ULTRA ZS405`); earlier
  firmware is matched on the `HW Version:` prefix — `V0.4.5` = ZS405 (Ultra),
  `V0.4.6` = ZS406 (Ultra+), `V0.5.` = ZS407 (Ultra+, the suffix changes between
  builds);
- build: the commit count after the `v1.4` tag (`v1.4-252` is newer than
  `v1.4-143`). The page warns below v1.4-182, the oldest build it and the
  library are written for.

The `help` reply decides which commands the page will send to this device
(`sa.has(cmd)`); the profile's command set is the fallback.

| Key | Board | Points | Markers | Scale | Screen | RBW (kHz) | Range (Hz) | Verified |
|---|---|---|---|---|---|---|---|---|
| `TINYSA_BASIC` | ZS304 | 3–290 | 4 | 128 | 320×240 | 2 … 600 | 100 k – 350 M | source |
| `TINYSA_ULTRA` | ZS405 | 3–450 | 8 | 174 | 480×320 | 0.2 … 850 | 100 k – 800 M (5.33 G ultra) | hardware, v1.4-143 and v1.4-252 |
| `TINYSA_ULTRA_PLUS_406` | ZS406 | 3–450 | 8 | 174 | 480×320 | 0.2 … 850 | 100 k – 900 M (5.42 G ultra) | source |
| `TINYSA_ULTRA_PLUS` | ZS407 | 3–450 | 8 | 174 | 480×320 | 0.2 … 850 | 100 k – 900 M (7.37 G ultra) | source |

Values come from the firmware source (`nanovna.h`, `sa_cmd.c`), the same place
tsapython's `_profiles.py` reads them. Frequency limits are the page's checking
envelope only; the device applies its own.

## Verified against hardware

- `tsapython/tests/fixtures/captured_responses.py` (Ultra, fw 1.4-143): the
  demo device reproduces these byte-for-byte for `deviceid`, `version`, `info`,
  `vbat`, `status`, `frequencies`, `scan` with masks 1/2/3/4, and the
  `scanraw` 5- and 15-point frames (format, not values).
- tsapython 4.0.0's hardware session, ZS405 on v1.4-252 (2026-10-18): the
  identification, the `help` command set, every gate above, `scanraw` with the
  bit-field argument, `capture` (480×320, big-endian RGB565 confirmed), and the
  generator sequence with the output on into a 50 Ω load (output on/off, level
  −76 … −6, 1 … 300 MHz, AM and FM, mode changes). The dropped-command race and
  its 200 ms window were measured there. What the generator puts out has not
  been measured with a receiver by either tool.

## Not yet verified on live hardware by this page

- Timing of `scan` at 450 points over USB (demo assumes ~2.5 ms/point).
- `marker N {Hz}` acceptance across firmware versions, and the reply format of a
  bare `marker` (the page reads it tolerantly: first integer = id, largest
  number = frequency, a non-integer between −150 and 30 = level).
- The generator's actual output (a receiver bench, not the console).
- Basic and Ultra+ in general.

Collect a diagnostic sample and open a *Scan problem* issue to add to this list.
