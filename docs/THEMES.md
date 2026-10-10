# Themes

The theme engine's home, and the brief for anyone building a Theme: what a Theme
is, the folder it lives in, every hook it may use, what it may never touch and the
one command that checks it. Code: `src/model/theme.js` (engine),
`src/themes/` (the Themes), `src/ui/ThemePicker.svelte` (the Display pane),
`src/style.css` `:root` (the default, and the paint before the engine runs).
Status lives on the board (`ph-vdk.64`).

A theme is a browser preference. Nothing here reaches the hub.

## Themes and variants

A **Theme** is a whole style: chrome (the title bar, the caption buttons, the
bars), controls (buttons, fields, switches, sliders, tabs, scrollbars), typography,
icons, textures, motion. A **Variant** is one palette of a Theme: accents, a
chassis, a look, pins. Luna is a Theme; Luna's Olive Green is a Variant of it. A
pure recolor is a Variant, never a Theme: the twelve color presets (Phosphor,
Tracer, Synth, Ember, Arctic, Vapor, Ultra, Sakura, Stealth, Slate, Warm ink,
Paper) are the Variants of the default Theme, **Phosphor**, whose style is
`style.css` itself.

The Display pane lists Themes first (one chip each, its swatch from its manifest),
then the active Theme's Variants (only when it has more than one), then the saved
presets. Picking a Theme applies its first Variant.

Three attributes on `<html>` say what is applied:

| attribute | holds | use it for |
|---|---|---|
| `data-style` | the Theme id (`luna`, `phosphor`) | scoping every rule of a Theme's stylesheet |
| `data-variant` | the Variant id, absent on a Custom theme | a rule that differs per palette |
| `data-theme` | the engine theme's id (a Variant id, `custom`, `user-...`) | never in a Theme's CSS; tests read it |

An edited theme is **Custom**: it keeps its Theme (`style`) and loses its Variant,
so a tweaked Luna keeps Luna's chrome and shows its own colors. The stylesheet of a
Theme reaches only shipped Theme ids: an import, a saved preset or a plugin theme
names a `style` and gets that Theme's layer, but carries no CSS of its own.

## Adding a theme

A Theme is a folder. Nothing outside it changes except one line.

```
src/themes/<id>/
  manifest.js    what the Theme is: name, pitch, swatch, note, material, icons, variants
  theme.css      every rule, scoped by html:root[data-style="<id>"]
  icons.js       its icon set (default export; {} keeps the stock glyphs)
  fonts/         optional: woff2 files its theme.css names with @font-face
src/themes/index.js     the registry: one line per Theme (below)
src/themes/kit.js       helpers a manifest or icon module may import
src/themes/fonts/       the three OFL faces some Themes share (fonts.css names them)
```

The registry line, in `src/themes/index.js`, alphabetical position free:

```js
export { default as luna } from './luna/manifest.js';
```

The stylesheet needs no line: `src/main.js` globs every `src/themes/*/theme.css`,
so the folder is its registration. Two agents adding two Themes conflict on at
most `index.js`, and a one-line conflict resolves by keeping both lines.

`manifest.js` default-exports:

```js
export default {
  id: 'luna', name: 'Luna',              // the folder name; the chip's name
  pitch: 'one fragment, no story',       // the chip's tooltip
  swatch: 'linear-gradient(...)',        // a CSS background: the chip's preview
  note: 'optional line under the chips', // a platform note (Mica, Liquid Glass, Material)
  material: 'mica',                      // optional: the OS material the window gets (below)
  wallpaper: true,                       // optional: the desktop wallpaper layer (below)
  icons,                                 // from ./icons.js
  variants: [                            // the first is the Theme's own palette: its id is the Theme's id
    { id: 'luna', name: 'Luna', accents: {...}, chassis: {...}, look: {...}, overrides: {...} },
    { id: 'luna-olive', name: 'Olive Green', ... },   // the others are prefixed by the Theme id
  ],
};
```

A variant is the engine's palette (The object, below): `accents` (reality, intent,
highlight), `chassis`, `look` and pinned `overrides`; any group left out takes the
engine's default. `kit.js` has `variant(id, name, reality, intent, chassis, extra)`
for the short form.

A Theme that **needs a hook the system lacks** adds it to the system, not around it:
a `data-part` on a component, a token in `style.css` `:root` listed in `LOCKED`, an
entry in the tables here. Say so in the
commit.

## Parts

Stable names on the key surfaces. Select them by attribute; a Svelte class
(`.linkbar`) is not a contract and carries a hash. A part is a place to dress; none
of them is a safety control (see Safety).

| `data-part` | the surface |
|---|---|
| `top` | the sticky top box: the bar over the safety strip |
| `bar` | the top bar: the link dot, the hub name, the chips, the caption buttons |
| `strip` | the safety strip: numerals, status slot, the Home, Flip, Override, Pause and Halt row |
| `stop-frame` | the frame around Pause and Halt: dress its surroundings (an outline, a plate behind them); the buttons themselves are not a part |
| `numerals` | the strip's hero numerals (`.hn-val` inside is the big readout) |
| `hero` | the bar under the strip: the rail scope and its tape |
| `rail`, `rail-sec`, `rail-label`, `rail-tab` | the sidebar, a section of it, a section name, a tab |
| `content`, `pane` | the scrolling area and the page in it |
| `card`, `nest` | a Dash or category card's body, and a nest's |
| `card-head` | a card's title row, above its body (not on a bare card) |
| `panel`, `panel-bar` | a plugin card (`api.ui.card`), and its title row inside it |
| `status-row`, `page-foot` | the bottom status row, and the page's own footer |
| `caption`, `caption-btn` | the shell's window buttons, and each one; `data-cap="min"`, `"max"` or `"close"` |

Global classes that are also contracts, because the shell's own controls and the
plugin kit draw them: `.og-btn` (`.sm`), `.og-seg button`, `.stepper button`,
`.og-num`, `.value-input`, `select`, `.og-switch .track`, `input[type=range]`,
`input[type=checkbox]`, `[role=radio]`, `[role=tab]`, `.og-panel`, `.og-screen`,
`.surface-card`, `.surface-nest`, `.dash-title`, `.pane-head h2`, `.field-label`,
`.chip`, `.wordmark`, `.tabs button`. The words `.primary` and `.on` and `.active`
are states of those controls; style them by adding to the base, never replacing
their colors.

## Tokens

The engine derives the colors (the neutrals, the text ramp, the lines, the accents
and their glows) from a Variant; read them with `var(--bg)`, `var(--bg-card)`,
`var(--bg-raised)`, `var(--bg-sunken)`, `var(--line-0..4)`, `var(--tx-hi)`,
`var(--tx)`, `var(--tx-val)`, `var(--tx-mut)`, `var(--tx-ghost)`, `var(--reality)`,
`var(--intent)`, `var(--highlight)` and the `-rgb` triples for alpha. **A surface
that carries text is built from the surface tokens**, so the contrast guard (The
chassis, below) holds for it; a gradient under text is a gradient between surface
tokens, or sits on a solid `background-color` that is one.

Tokens only a Theme's stylesheet sets (declared in `style.css` `:root` with an inert
default, listed in `LOCKED`: a user pin or an import cannot reach them):

| token | default | consumed by |
|---|---|---|
| `--font`, `--mono` | Chakra Petch, Martian Mono | every control and readout |
| `--font-head` | `var(--font)` | `.dash-title`, `.card-sub`, and what you point it at |
| `--tex-page`, `--tex-page-size` | `none`, `auto` | the page background, fixed, under everything |
| `--tex-card`, `--tex-card-size` | `none`, `auto` | `.surface-card` and `.surface-nest` |
| `--frame-w` | `1px` | the card and nest frame |
| `--ease-out` | the shell's | transitions (set it for an easing of your own) |

High legibility (`html.hivis`) clears `--tex-page` and `--tex-card` for every
Theme; shapes, fonts and frames stay. Do not set the touch floor, the slider thumb
sizes, `--tap` or the ladder tokens; they are `LOCKED` for a reason (law 12).

Selectors in a Theme's sheet are written `html:root[data-style="<id>"] ...`: the
`html:root` prefix outranks the components' scoped rules. A rule that still loses to a
doubled component selector says so in `Parts`' way: add a `[data-part]` hook rather than
`!important`.

## Icons

The rail's glyphs are the icon registry's. `src/ui/navIcons.js` exports `ICON_NAMES`
(the category names `generator`, `motion`, `safety`, `limits`, `playback`, `auxiliary`,
`automation`, `hardware`, `network`, `session`, `system`, `other`, `setup`, and
Phosphor's panes `machine`, `pairing`, `valence`, `log`, `display`, `plugins`, `hubs`,
`server`, `settings`, `merge`, `about`) and `NAV_PATHS` (the stock path of each, a
16-unit viewBox drawn open at a 1.5 stroke). A glyph's wrapper carries
`data-icon="<name>"`.

A Theme's `icons.js` default-exports `{ name: icon }`, any subset; a name left out keeps
the stock glyph. An icon is either

- a **mask**: a string, the inner markup of a 16-unit viewBox. The engine wraps it in an
  `<svg>` with `fill="none" stroke="#000" stroke-width="1.5"` and round joins and paints it in the
  control's text color. Filled shapes name `fill="#000" stroke="none"`. Or
- a **colored icon**: `{ svg: '<svg xmlns=... viewBox="0 0 16 16">...</svg>' }`, drawn with
  its own colors (`kit.js` `color()` wraps the inner markup).

`kit.js` has `stockIcons(fn)` (one icon per name from the stock path) and `pixelIcons()` (the
8 x 8 set). Draw your own; copy no one else's asset. The stop pair's icons and the
plugins' own page icons are not in the registry and cannot be replaced.

## Chrome hooks

What a Theme dresses besides the controls:

- **Title bar.** The top bar is the title bar: `[data-part="bar"]` (background, radius,
  shadow), `.wordmark` (the hub name) and `.chip` inside it. `[data-part="top"]` is the box
  around bar and strip; make it transparent to show the page behind a rounded bar.
- **Caption buttons.** `[data-part="caption-btn"]` with `data-cap`, 30 to 46 px wide, the
  bar's full height, an inline `<svg>` glyph (`stroke: currentColor`). Draw the face on
  `::before` and keep the hit box; the close button asks the hold-to-close popover first, which
  is not a part.
- **Scrollbars.** Scrollbars are the user's preference (`html[data-scrollbars]`). To shape them:
  `* { scrollbar-width: auto; scrollbar-color: auto }`, then `::-webkit-scrollbar`,
  `-track`, `-thumb` under your prefix. Never set `display` on them: the preference hides them
  with a rule yours does not outrank.
- **Controls.** Buttons, segmented buttons, steppers, fields, selects, switches, sliders, check
  boxes, radios, tabs, progress: the global classes above. A button's colors and `box-shadow`
  carry its state (on, primary, the running and danger states, the write ladder's ring); give a
  control its shape, face (`background-color`, `background-image`), type and radius, and put
  anything that touches a state color behind `:not(.on):not(.primary):not(.running):not(.danger)`.
  A slider thumb keeps its size (`--slider-thumb-w`, `-h`) and its `:active` border.
- **Cards.** `[data-part="card"]` and `nest` take a frame (`--frame-w`, `border-radius`, a
  `box-shadow` outside), a texture (`--tex-card`) and a `padding-top`. A card's fault state paints
  `border-color` and `background-image` over yours; leave `border-color` to the line tokens.
  `[data-part="card-head"]` and `panel-bar` may be a band, a caption on the frame or plain text.
- **Ambient motion.** `html::before` is free: a fixed, `pointer-events: none`, `z-index: -1`
  layer under the page (a scanline band, a falling grid). Animate `transform` and `opacity` only,
  in a keyframe named `theme-<id>-<name>`, under `:not(.still)` (and `:not(.hivis)` where it
  would distract). `html.still` is the user's, the OS's and the motion knob's "hold still".

## Fonts

System stacks need nothing. Three OFL faces are bundled for any Theme to name: VT323
(`'VT323'`), Silkscreen (400 and 700) and Orbitron (a variable face, 400 to 900), subset to
Latin in `src/themes/fonts/` (`fonts.css` declares them; `fetch.py` rebuilds them; `OFL.txt` is
their licenses). A Theme with a face of its own puts the woff2 in its own `fonts/`, declares it
in its `theme.css` with `src: url('./fonts/<file>.woff2')`, adds its OFL text beside it and says
what it added to the bundle in the commit. No CDN, ever; the test fails a remote `url()`.
Budget: the bundled faces are 45 KB; a Theme's own faces stay under 60 KB together.

## Safety

The theme system's rule, and the only one a Theme may not discuss (RENDERING law 13): the stop
pair (Pause, Halt, E-Stop), the safety edge, the write ladder's ring, warn and error states and
the stale states look the same in every Theme, legible, at their contrast. A Theme may dress their
**surroundings** (`stop-frame`, the strip behind them) and take its radius from `--radius`; it may
not restyle, hide, shrink, re-color or cover them, and it adds no red, amber or hazard stripes
anywhere that could read as one. `test/theme-skins.test.mjs` lints your `theme.css` for the
selectors and tokens that touch them (`.safety-op`, `.btn-estop`, `.latched`, `[data-shadow`,
`.stale`, `.field::after`, `--warn`, `--bad`, `--estop`, the running and danger classes outside a
`:not()`...), and measures the pair in a browser: visible, 40 px or more, opaque, the default hazard
stripe, AA text.

Text: `--tx` and `--tx-hi` 4.5:1 and `--tx-mut` and `--tx-ghost` 3:1 on every surface text sits
on, by the engine's guard (The chassis); accents 4.5:1 on every surface (a Variant that fails it
fails the kit); the safety inks derive per chassis. A pinned surface or text token bypasses the guard
and is yours to verify; the kit checks every Variant's ratios and every page's computed text.

## The test kit

```
node test/theme-skins.test.mjs --theme <id>      one Theme: lint, three sizes, six pages, variants, screenshots
node test/theme-skins.test.mjs                   every Theme (minutes)
```

`npm run build:only` is not needed: the kit builds the shell bundle itself. It runs against a fake hub
on the recorded catalog and checks, for the Theme and each of its Variants:

- **registry** the folder, the registry line, ids, variant ids, icon names, every Variant's engine ratios;
- **lint** the sheet (above), no remote URLs, every rule under your prefix, keyframes named `theme-<id>-*`
  that move only `transform` and `opacity`, every animation under `:not(.still)`;
- **fit** at 1428x900, 1024x768 and 420x860, on the Dash, a category page, the funscript player, the Log,
  the Link page and Settings: no horizontal scroll beyond what the default theme has, no page error;
- **shift** the top strip, the safety strip and the status row keep their heights; hovering and focusing
  twelve controls moves no box;
- **text** no element under AA that the shipped Phosphor and Paper presets do not also have (compared by
  class, so a dim label the default also dims is exempt, and a new failure is not);
- **stop pair** visible, 40 px, opaque, the default's size and stripe, AA text, on every page size;
- **reach** the center of every visible button hits that button (decoration blocks nothing);
- **motion** under reduced motion no `theme-*` animation runs;
- **picker** the chip, its swatch and tooltip, its Variants under it, F3 finding it;
- **material** and **dynamic**, below.

Screenshots (the Dash and the funscript page at 1428x900, the Dash at 420x860, one per Variant) land in
`test/evidence/themes/` (git-ignored). Before you hand a Theme back: the kit passes for it, `npm run check`
passes, and you looked at the screenshots at all three sizes. `test/theme.test.mjs` and
`test/theme-browser.test.mjs` (every Theme under hi-vis) are part of `npm run check` and the browser chain.

## Materials

Three Themes ask for more than a stylesheet. All three are **starting points** (a working
first pass the Theme's owner replaces and deepens); the platform plumbing under them is the
shared part. Each falls back to an opaque look of the same style where the platform has no
material, and the picker says so (the manifest's `note`, plus "now: opaque look" or what the
window got).

**The window.** `src-tauri/tauri.windows.conf.json` and `tauri.macos.conf.json` create the main
window `transparent` (Windows and macOS only; the macOS file also sets `macOSPrivateApi`, which
Tauri requires for a transparent window and which excludes the Mac App Store, where this app is
not sold; Cargo enables the `macos-private-api` feature for macOS only). Every other Theme paints an
opaque body, so the transparency is invisible. `src-tauri/src/material.rs` `window_material(kind)`
chooses what shows through, answering what it applied (`mica`, `acrylic`, `glass`, `vibrancy`,
`none`); `src/model/material.svelte.js` calls it from the shell, sets `html[data-material]` to the
answer and removes it again while a page is fullscreen (`html[data-page-full]`), when the OS asks
for reduced transparency, or when the Theme has no `material`. A Theme's transparent rules are
gated on `[data-material]`: without it the page is opaque.

Verified against the installed Tauri 2.11.5 and window-vibrancy 0.6.0
(`tauri::window::Effect`, `EffectsBuilder`, `WebviewWindow::set_effects`, `WindowEffectsConfig`):

| platform | what the shell gets | notes |
|---|---|---|
| Windows 11 | `Effect::Mica` (system backdrop), forced dark with `MicaDark` where the Theme is dark | window-vibrancy refuses Mica elsewhere: the answer is `none` |
| Windows 10 and 11 | `Effect::Acrylic` with a tint color | slow while dragging or resizing on 22000 and 22621+ builds (window-vibrancy's note); `Blur` is the older, equally slow option |
| macOS before 26 | `Effect::HudWindow` (or `UnderWindowBackground`, `Sidebar`, `Titlebar`: any `NSVisualEffectView` material) under the transparent web view | |
| macOS 26 and later | `NSGlassEffectView` (AppKit), added as the window's bottom subview beneath the web view through `ns_window()` (`material.rs`, module `mac`) | looked up by name at run time; its `style` (regular, clear), `cornerRadius` and `tintColor` are the knobs to verify in the SDK headers |
| Linux | none | WebKitGTK composites an opaque page; nothing to ask for |
| Android, iOS, the browser build | none | the Theme draws its opaque look |

Chromium's `backdrop-filter` blurs page content only, never the desktop: the desktop blur is the OS
effect, and in-page glass needs in-page content behind it (the wallpaper layer, below, or the Theme's
own backdrop).

**Contrast over a see-through window.** The test kit's `material` section sets
`html[data-material]`, lays a white, black or mid backdrop under the window and audits every page with
each ancestor's background composited over it (`test/audit.mjs` `lowContrastOver`). A surface that
carries text is a tint of a surface token at 82% (Mica forced dark never reads lighter than about
`#3A3A3A`: audited over black and `#3A3A3A`) or 96% (Liquid Glass: audited over black and white); labels
are pinned bright so they hold 3:1 at that tint. The stop pair sits on an opaque plate and is itself
opaque in every mode.

**Mica** (`src/themes/mica/`): Fluent. Mica forced dark behind 8 px cards on hairline white strokes,
4 px controls, a top-light fill and a lighter fill on hover (the reveal), a Fluent selection pill on the
rail. Owner: the reveal highlight that follows the pointer (a pointer-move handler setting two custom
properties on the hovered control, never per frame), the title-bar region (caption buttons in Fluent's
shape), acrylic cards on the wallpaper layer, the 11-style type ramp, an icon set of Fluent's weight.

**Liquid Glass** (`src/themes/glass/`): capsules, specular top rims, layered translucent cards with a
blurred, saturated, dimmed backdrop on bounded surfaces only (cards, pills, menus, the rail; never a
full-page layer). Three modes by two attributes: `[data-wall]` (the wallpaper layer is the backdrop: a
66% tint over it), `[data-material]` alone (the OS glass: a 96% tint, the content a tinted sheet) and
neither (an opaque window: an aurora gradient the cards blur). Owner: real `NSGlassEffectView` on macOS 26
(verify the class and its properties in the SDK on the Mac: `ssh -i ~/.ssh/openvalence_mac
atlantic@Atlantics-MacBook-Air.local`, then `npx tauri build --bundles app`), glass on every control (the
slider thumb and track, the switches, chips, menus, the tooltip, drawers, the quick-access dock, the stop
pair's frame), press and hover that brighten and compress, a light refraction on bounded surfaces
(an SVG displacement filter is allowed on a card, never on a large area).

**The wallpaper layer** (not built; the contract): a Rust command returns the current monitor's wallpaper
file path, fit mode (center, tile, stretch, fit, fill, span), the monitor's rectangle and the window's
rectangle inside it, and the page paints the image as a fixed bottom layer placed and scaled so it
lines up with the desktop behind the window, then dims it (a black overlay in the layer itself, not a
filter: a white wallpaper must still leave the text 4.5:1). It reads only the wallpaper file, never a
screen capture. Windows: `IDesktopWallpaper::GetWallpaper` per monitor, or `SystemParametersInfo`
`SPI_GETDESKWALLPAPER`, and the registry's `WallpaperStyle` and `TileWallpaper`; macOS:
`NSWorkspace.desktopImageURL(for:)` and `desktopImageOptions`; Linux: GNOME `gsettings org.gnome.desktop.background
picture-uri`, KDE's plasma config, else none. The image reaches the page as bytes (an IPC `Response`,
decoded to a `blob:` URL: the CSP allows `blob:` images), not a file URL. Follow the window's move,
resize and monitor-change events (`getCurrentWindow().onMoved`, `onResized`, debounced, never per
frame); reload on the OS change notification if it is cheap, else on window focus. A slideshow, a
dynamic wallpaper, no path, reduced transparency, reduced motion or a fullscreen page turn it off and the
Theme draws its material or opaque look. `html[data-wall]` is set while it shows. Measure idle, moving the
window, and a windowed 4K video, and say so in the commit.

**Material** (`src/themes/material/`): Material 3. Tonal surfaces (the accent mixed into each surface a few
percent, containers more), stadium buttons (tonal by default, filled for `.primary`), 8 and 12 percent
state layers, the M3 type scale in `Roboto Flex`, the emphasized easing in `--ease-out`. **Dynamic color is
the showpiece.** On Android 12+ `src-tauri/android/MainActivity.kt` reads the system palette
(`android.R.color.system_accent1_*`, `accent2`, `accent3`, `neutral1`, `neutral2`, tones 0 to 1000) and
publishes it as `window.__phosphorSystemPalette` plus a `phosphor-system-palette` event, at document start and on
layout; `src/model/dynamicColor.js` turns it into the Theme (surface from neutral tone 900 or 10, accents
from tone 200 or 600), clamps every accent to 4.5:1 on every surface, turns one off a safety hue, applies
it without persisting and sets `html[data-md-scheme]` (`light` for a day palette; `--on-reality` follows
it). Below Android 12, on the desktop and in the browser the fixed baseline in the manifest stays. The
Android path needs an APK build to be seen (`tools/android-icons.mjs` copies `MainActivity.kt` into the
generated project; `npm run build:android`). `test/dynamic-color.test.mjs` runs 132 fake palettes through the
derivation; the kit's `dynamic` section injects four into the page and audits the pages and the stop pair.
Owner: FAB-like affordances where one fits, the switch and slider shapes, a type scale on every label, a
ripple that is a state layer (no per-frame animation), Material Symbols' weight in `icons.js`.

## The object

```json
{
  "id": "custom", "name": "Custom", "style": "luna",
  "accents":  { "reality": "#4DA6FF", "intent": "#A78BFA", "highlight": null },
  "chassis":  { "hue": 263, "tint": 1, "brightness": 0.14, "contrast": 1 },
  "look":     { "glow": 1, "radius": 2, "scale": 1.12, "numWeight": 400, "motion": 5 },
  "overrides": { "--bg-card": "#203040" }
}
```

`normalizeTheme` turns any stored, imported or plugin shape into this one: a bad
field takes its default, a knob is clamped to its range, and the old
`{id, name, reality, intent}` accent pair is accepted as it is. `style` is the Theme
(an unknown or missing one takes the Theme the `id` belongs to, else Phosphor); the
old `skin` field reads as `style`.

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
readout is how the user sees a weak one or a safety look-alike. No Variant
trips either (`test/theme-skins.test.mjs`). The slot's shape follows its width,
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
newline is refused, in its own row: it could leave its declaration. A Variant
pins lines and surfaces here when it wants an exact palette (Luna's steel
blue lines, DMG's four LCD tones); pinned text and surfaces are verified by the kit.

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
- the Theme tokens (Tokens, above): a Theme's sheet sets them, a pin cannot.

`test/theme.test.mjs` fails when a `:root` custom property in style.css is
in neither `TOKENS` nor `LOCKED`.

## The shipped themes

`phosphor` and its twelve Variants are the originals; the rest are Themes under
`src/themes/`, each a starting point its owner deepens. Ember's intent left the
safety amber for its reality's complement, `#4CCEFE` (ph-76i, veto-able). Slate,
Warm ink (hue 60; its reality left the safety amber for jade, `#66D5BA`) and Paper
(the light chassis) were added, veto-able.

| Theme | Variants | first pass |
|---|---|---|
| `phosphor` | the twelve color presets | the default style: style.css |
| `luna` | Luna, Olive Green, Silver | the 2001 chrome and controls in full: title bar, caption buttons, group boxes, orange-glow buttons, green checks, tabs, scrollbars |
| `hellscape` | one | brick, bevels, a HUD status bar, a gutter-flicker, pixel face for labels |
| `p1` | one | green phosphor, scanlines, a rolling band, a blinking cursor |
| `platinum` | one | pinstripe title bars with a plate, gray bevels |
| `dmg` | one | four-tone LCD pinned in the manifest, a pixel grid, a bezel bar |
| `blueprint` | one | drafting blue, grid paper, dashed frames |
| `outrun` | one | neon on a sunset, a sliding perspective grid |
| `rack` | one | brushed metal, screws, LED readouts |
| `amp` | one | a music player: bevels, grip-striped title bar, list rail |
| `jelly` | one | pinstripes, glossy capsules, jelly icons |
| `setup` | one | a BIOS blue screen: double lines, reverse video |
| `boing` | one | gray gadgets, copper-bar title bars, depth gadgets |
| `cipher` | one | falling code behind black glass |
| `notebook` | one | ruled paper, stitched cards, felt-pen icons |
| `contrast` | one | black, white and cyan, thick frames, no texture |
| `mica` | one | Fluent on Windows 11 Mica (Materials) |
| `glass` | one | Liquid Glass (Materials) |
| `material` | one | Material 3 and Material You (Materials) |

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
| `phosphor.theme` | the active theme object; a shipped Variant's id loads that Variant as this build ships it, with its stored look |
| `phosphor.theme.presets` | saved presets (with their `style`) |
| `sd32.theme`, `sd32.theme.customColors` | legacy: read once to migrate when `phosphor.theme` is absent, never written or deleted |

An old preference maps without a rewrite: a stored `id` that is a Variant (`slate`, `ember`,
`luna`) is that Variant of the Theme that owns it, so `slate` is the Phosphor Theme with its Slate
variant; the `skin` field of the earlier build reads as `style`; a Custom theme with neither is the
default style. `test/theme.test.mjs` pins each mapping. A legacy id that names a plugin theme is
applied when its plugin registers it and is not written over before then. The settings backup
carries every `phosphor.` key (`src/model/prefs.js`).

## Renderers

`ACCENT` and `ac()` (mutated in place on apply) feed the accent canvases;
`ac('h', a)` is highlight. A canvas that paints neutrals re-reads its tokens
in `onTheme()` (`PlanStrip`, `TelemetryChart`, which also watches `<html>`'s
class for hi-vis), and `dashboard.svelte.js` re-reads the base `--s`.
