# Themes

The theme engine's home: the object, the knobs, the token set and what no
theme can reach. Code: `src/model/theme.js` (engine), `src/ui/ThemePicker.svelte`
(the Display pane), `src/style.css` `:root` (the default, and the paint
before the engine runs). Status lives on the board (`ph-vdk.64`).

A theme is a browser preference. Nothing here reaches the hub.

## The object

```json
{
  "id": "custom", "name": "Custom",
  "accents":  { "reality": "#4DA6FF", "intent": "#A78BFA", "highlight": null },
  "chassis":  { "hue": 263, "tint": 1, "brightness": 0.14, "contrast": 1 },
  "look":     { "glow": 1, "radius": 2, "scale": 1.12, "numWeight": 400, "motion": 5 },
  "overrides": { "--bg-card": "#203040" }
}
```

`normalizeTheme` turns any stored, imported or plugin shape into this one:
a bad field takes its default, a knob is clamped to its range, and the old
`{id, name, reality, intent}` accent pair is accepted as it is.

## Accents

| accent | means | tokens |
|---|---|---|
| reality | measured truth (RENDERING semantics) | `--reality`, `--reality-rgb`, `--good`, `--glow-reality` |
| intent | requested, not yet confirmed | `--intent`, `--intent-rgb`, `--intent-deep-rgb`, `--glow-intent` |
| highlight | focus rings, text selection, the dragged thumb, a pressed button, the active swatch | `--highlight`, `--highlight-rgb` |

`highlight: null` follows reality, so every preset that predates it looks as
it did. Highlight never means a state: an active (on) control, a confirmed
value and a live readout stay reality.

## Chassis

Four knobs derive every neutral: the surfaces (`--bg`, `--bg-raised`,
`--bg-card`, `--bg-sunken`, `--shell-bg`), the lines (`--line-0..4`), the
text ramp (`--tx-hi` to `--tx-faint`), the hi-vis and prefers-contrast sets,
`--shade-rgb` and the panel brackets. The math is OKLCH and the engine emits
hex, so CSS and canvases paint the same color.

| knob | range | does |
|---|---|---|
| hue | 0..360 | rotates every neutral's hue; 263 is the default's |
| tint | 0..4 | chroma multiplier; 0 is pure gray, 1 the default |
| brightness | 0..1 | the page's lightness; 0.14 is the default `--bg` |
| contrast | 0.5..2 | ramp spread: surfaces move further apart, lines and text further from `--bg` |

How the ramp moves:

- Surfaces keep their lightness offset from `--bg`, scaled by contrast. A
  card is lighter than the page on any chassis.
- Lines and text sit at a fixed fraction of the way from `--bg` to the far
  extreme: white on a dark chassis, black on a light one. The extreme is
  whichever reads stronger on the weakest of `--bg`, `--bg-card` and
  `--bg-sunken` (`--bg-raised` lies between `--bg` and `--bg-card`).
- The default chassis reproduces style.css's `:root`, hi-vis and
  prefers-contrast values exactly (`test/theme.test.mjs`).

The contrast guard: `--tx` and `--tx-hi` never fall under 4.5:1, and
`--tx-mut` and `--tx-ghost` never under 3:1, on any surface text sits on.
`--tx-ghost` is the quietest step that may label anything (chrome keys,
hints, ruler numerals); `--tx-faint` is decorative only (index numerals,
watermarks), never a label. A guarded step moves toward the extreme; a
mid-gray chassis no extreme can clear is moved away from the middle until
one does.

The editor's readout is a fixed slot that never wraps or clips: the live
ratios (text, labels, reality), each a label over its number, against the
worst of the three surfaces text sits on, then a note naming any accent
that reads as a safety color, e.g. "Intent near safety amber": its OKLCH
hue within 20 degrees of `--warn` or `--bad`, chroma 0.05 or more
(`nearSafety`). Accents are not guarded: they are the user's pick, and the
readout is how the user sees a weak one or a safety look-alike. No preset
trips either (`test/theme.test.mjs`). The slot's shape follows its width,
never the digits: three lines, or four (one ratio per line) where the slot
is under 15em, as at the 200 px floor.

`color-scheme` follows the chassis.

## Look

| knob | range | does |
|---|---|---|
| glow | 0..2 | multiplies `--glow-reality` and `--glow-intent`; sets `--fx-g-peak`, the field echo's peak, clamped to 0.25..1 so the echo never vanishes (law 5) |
| radius | 0..12 px | `--radius` (and `--r`, `--r-s`) |
| scale | 0.8..1.6 | `--s`, the base control scale. The builder's Layout scale (DESIGN §10.6) multiplies it |
| numWeight | 300..700 | `--num-wght`; hi-vis adds 80 |
| motion | 0..10 s | `--fx-glow`, the echo's decay. 0 sets `html.still`: the reduced-motion rules of style.css, chosen in the app. Canvas animations still follow the OS setting only |

## Overrides

Any themeable token may be pinned to an explicit CSS value; a pin wins over
the derived value, the hi-vis set included. The Advanced section lists every
token (`TOKENS`, generated from the derivation, so a new token cannot be
missed) with its derived value (one line; the whole value rides its title),
a field and a reset. A value holding `;`, `{`, `}`, `<`, `>`, `\` or a
newline is refused, in its own row: it could leave its declaration.

## Not themeable

`LOCKED` in theme.js, each with its reason; no preset, knob, override,
import or plugin can reach them:

- safety: `--warn`, `--bad`, `--warn-rgb`, `--bad-rgb`, `--estop`,
  `--glow-warn` (RENDERING law 13). The editor shows the colors as locked
  swatches.
- safety text: `--warn-ink`, `--bad-ink`, the safety color's own hue at the
  nearest lightness that reads 4.5:1 on every surface; a dark chassis keeps
  the raw color. Derived per chassis, never pinned. Text in a safety color
  uses the ink (`var(--warn-ink, var(--warn))` where a sheet can paint
  before the engine); glows, fills and borders keep `--warn` and `--bad`.
- touch floor: `--tap`, `--range-hit`, `--slider-thumb-w`, `--slider-thumb-h`
  (law 12).
- the ladder's curve and timings other than `--fx-glow`.
- `--chrome-inset-top` (the one safe-area owner), the two bundled fonts, and
  `--og-brackets` (derived from the lines).

`test/theme.test.mjs` fails when a `:root` custom property in style.css is
in neither `TOKENS` nor `LOCKED`.

## Presets

The nine originals keep their ids and names on the default chassis. Ember's
intent left the safety amber for its reality's complement, `#4CCEFE`
(ph-76i, veto-able). Added, veto-able: Slate (cool, tinted, a touch
brighter), Warm ink (hue 60; its reality left the safety amber for jade,
`#66D5BA`), Paper (the light chassis). Saved presets are local, named and
deletable.

**The light chassis (Paper).** Shipped because it holds the measurable bar:
text clears 4.5:1 by the guard, its accents (darker than the dark presets'
on purpose) clear 4.5:1 on every surface, the safety inks darken to 4.5:1
(`#8F6300`, `#D50E36`), and under hi-vis every category page passes the
same WCAG audit the default does (`test/theme-browser.test.mjs`). What a
light chassis costs: glows read as soft halos rather than light on a dark
screen, so the phosphor look is weaker there; the rail's comet core darkens
instead of lightening.

## Storage

| key | holds |
|---|---|
| `phosphor.theme` | the active theme object; a shipped preset's id loads that preset as this build ships it, with its stored look |
| `phosphor.theme.presets` | saved presets |
| `sd32.theme`, `sd32.theme.customColors` | legacy: read once to migrate when `phosphor.theme` is absent, never written or deleted |

A legacy id that names a plugin theme is applied when its plugin registers
it and is not written over before then. The settings backup carries every
`phosphor.` key (`src/model/prefs.js`).

## Renderers

`ACCENT` and `ac()` (mutated in place on apply) feed the accent canvases;
`ac('h', a)` is highlight. A canvas that paints neutrals re-reads its tokens
in `onTheme()` (`PlanStrip`, `TelemetryChart`, which also watches `<html>`'s
class for hi-vis), and `dashboard.svelte.js` re-reads the base `--s`.
