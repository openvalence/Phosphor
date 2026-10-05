# Write feedback: the phosphor glow

How a field shows the write ladder (RENDERING §8.1, laws 5, 8, 12, 13): which
effect was chosen, the two that were not, and why. Status lives on the board
(`ph-vdk.62`), the rules in `src/style.css` (GROUND TRUTH block), the guards in
`test/control-contract.test.mjs` (`[effect]`, `[anatomy]`).

## The brief (operator, 2026-10-02)

- The outer ring is the right size and place, but it grew INWARD. Draw it
  outside the box (an offset), so the content never shrinks.
- No outline around the slider: the thin gray line the handle rides carries
  the effect.
- The status words must never move the control.
- The confirm glow is a soft, slow fade, about 5 s, like glow in the dark, or
  phosphor: it says "this value has changed".

Fixed for every candidate: the ring is a pseudo-element 3 px outside the
field's box; the slot is one fixed 14 px line in the head row; tokens only
(`--intent`, `--reality`, `--warn`, `--shade`); fault is steady amber;
reduced motion gets a still version; no state changes any box (asserted).

## The three candidates

See them live: serve the repo root and open `test/effect-lab.html` (Replay
write, fast echo, refusal, a 5 Hz drag; reduced motion, hi-vis and theme
toggles). `node test/effect-lab.mjs --out <dir> [--theme "FF8A4D FFD24D"]`
writes each candidate frozen at 0.1 s, 2 s and 5 s after the echo, plus the
reduced-motion sheet. Each sheet holds every state for slider, knob,
stepper, segmented and toggle.

### A. Afterglow ring (chosen)

- Confirmed: the ring and the line light in `--reality` on the echo and decay
  over 5 s on a phosphor curve: a fast flash term (30 %, tau 0.3 s) over a
  slow glow term (70 %, (1 - t/5 s)^1.6). Measured on the ring: 0.65 at 0.5 s,
  about 0.3 at 2 s, 0.16 at 3 s, 0 at 5 s. The line's glow bleeds out from the
  handle and recedes into it as it fades. The word "confirmed" lasts exactly
  as long and fades with it.
- Pending: the ring breathes in `--intent` (1.8 s); the line holds an intent
  tint at the handle; once a write has waited 250 ms, pulses run in from both
  ends of the line toward the handle.
- Overdue: the same in amber, slower (2.8 s breath, slower pulses).
- Held (Alt-drag, ph-vdk.60.11): the ring breathes in `--intent` with no
  pulses, since nothing is in flight; the readout shows the held number in
  `--intent` and the slot says "sends on release". One write leaves on
  release, none on a cancelled pointer. The rail's tape, window and edges
  wear their inset pending ring. Touch and the keyboard stay live
  (`src/ui/defer.js`).
- Locate (F3 look-for, ph-vdk.60.11): the ring's line lights dim in
  `--intent` and one soft arc runs once clockwise around it over `--loc-ms`
  (2 s, Field.svelte), then fades. Any write state puts it out at once.
  Reduced motion holds the dim line for the same 2 s.
- Says: "your value is on its way" (pulses converge on it), then "the machine
  took it" (the field lights), then "this changed recently" (the fade).

### B. Trace

- The line tells the story: pending runs a pulse from where the machine IS
  (the old value) to the handle; the echo runs a bright head along that path
  and leaves the old-to-new segment lit, decaying over 5 s. Off the slider
  (no old position) the whole underline flashes.
- The ring only marks in flight (dim breath) and refused (amber).
- Says the most (how far the value moved), but only on a slider, and it
  drops the operator's own ask: the ring is the part that fades.

### C. Persistence

- Everything the echo changed is painted bright and decays like a CRT: the
  digits brightest and longest, then the handle and line, the ring first
  (the ring follows the square of the glow).
- Pending: a dim ring that jitters 1 px at 2 Hz (the beam waiting); overdue
  slows it to 1 Hz and turns amber.
- Says "what changed" most directly, but a glowing writable value borrows the
  live-measurement voice (`.field-value.readout` is the reality glow), and
  the jitter reads as a rendering fault on a page where nothing may move.

## Costs (measured)

`test/effect-lab.html`, headless Chromium, 30 fields animating at once for
3 s, devicePixelRatio 2:

| | style recalc / 3 s | layout / 3 s | dropped frames |
|---|---|---|---|
| A glowing | 403 ms | 2 ms | 0 |
| A pending | 502 ms | 0 | 0 |
| B glowing | 483 ms | 3 ms | 0 |
| C glowing | 538 ms | 66 ms | 0 |
| C pending | 684 ms | 0 | 0 |

- The driver is that the ladder lives in inherited registered properties, so
  a field's subtree restyles each frame while it animates: about 0.07 ms per
  field per frame for A on this desktop, and nothing at rest (no animation
  runs on a settled field). Paint is a 2 px line, one ring with two blurs and
  a knob arc; no layout in A or B. C pays layout for its glowing digits.
- Upgrade path if a phone strains under a preset that lights 30 fields: move
  the ring onto its own opacity-animated layer (compositor only) and keep the
  properties for the line.
- Hi-vis: no text changes color except the slot word, which fades from
  `--reality` to `--tx-mut`; both ends clear 4.5:1 on the card. The ring and
  the line are not text, and carry no fact the words do not.

## Why A

- It is the operator's direction, literally: the ring is the carrier, drawn
  outside; the line the handle rides carries the state; the fade is soft and
  about 5 s.
- One meaning per element: the ring answers "did this field change, and is it
  settled?", the line answers "where is my write right now?". B and C each
  overload one element.
- It reads the same on every presentation (slider track, knob arc, stepper
  box, chosen option, switch track, an action's ring), which law 5's "one
  visual vocabulary" asks for. B degrades to a flash off the slider.
- Cheapest of the three, and nothing in it moves a box.

## Decisions inside A, with their reasons

- **The follow (`--fx-follow`, 160 ms) is a low-pass, not a style.** A drag
  alternates pending and settled at the channel's write rate (measured: about
  30 ms settled in every 200 ms at 5 Hz). An unfiltered switch strobes the
  ring at 5 Hz. It stays under reduced motion, because it fades a color and
  moves nothing.
- **The pulses start 250 ms into a write**, so a drag never shows them: only
  a write that is really waiting does.
- **A new write puts the afterglow out at once.** The ring never shows
  "settled" while a write is pending (Ground Truth). The glow restarts on
  every echo (two keyframe names alternate, so an echo in the same frame as
  its write still restarts it).
- **Stale kills the glow** (law 8): a silent hub cannot have just answered.
- **Reduced motion**: no breath, no pulses; the echo holds a steady glow at
  0.6 for the same 5 s, then clears.

## Known limits

- Theme Ember's intent (#FFD24D) sits next to amber (#F5B94D), so pending and
  overdue differ there by breath rate and the slot's words more than by hue.
  A theme question, not an effect one (`src/model/theme.js`).
- Safety ops, the top strip's flip chip and the drill-in badge keep the older
  inset ring (`[data-shadow]:not(.field)` in style.css); moving them to this
  language is their owners' change.
- The dual-thumb range, select, text, bitfield, color and time fields carry
  the ring and the words but no line.
