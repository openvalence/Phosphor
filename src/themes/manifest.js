/**
 * manifest.js -- the skins this build ships: each one a theme (accents, chassis,
 * look, pins) plus a stylesheet layer (src/themes/<id>.css, scoped by
 * `html:root[data-skin="<id>"]`) and an icon set. theme.js turns each entry into
 * a preset; docs/THEMES.md (Skins) is the contract.
 *
 * Constraints:
 * - Pure data, no DOM: node tests import it with theme.js.
 * - An entry never names a safety token. Its stylesheet is linted for the stop
 *   pair, the safety edge, the ladder and the stale states (test/theme-skins.test.mjs).
 * - Fonts are system stacks or the bundled faces (src/themes/fonts.css), never a CDN.
 * - `icons` is keyed by ICON_NAMES (ui/navIcons.js); see icons.js for the two forms.
 * - `swatch` is a CSS background for the picker's preview chip.
 */
import { LUNA_ICONS, PIXEL_ICONS, JELLY_ICONS, SKETCH_ICONS, FLUENT_ICONS, GLASS_ICONS, ROUND_ICONS } from './icons.js';

export const SKINS = [];
const skin = (e) => SKINS.push(Object.freeze(e));

skin({
  id: 'luna', name: 'Luna',
  pitch: 'Blue title bars and beige windows on a green hill',
  swatch: 'linear-gradient(180deg, #2A6DE6 0 38%, #ECE9D8 38% 100%)',
  theme: {
    accents: { reality: '#0A4FC0', intent: '#7B2FB8', highlight: '#1F6E1F' },
    chassis: { hue: 100, tint: 1.2, brightness: 0.94, contrast: 1 },
    look: { glow: 0.3, radius: 3, scale: 1.12, numWeight: 400, motion: 3 },
    // Steel-blue control borders; lines carry no text.
    overrides: { '--line-1': '#B8C6DA', '--line-2': '#8AA3C6', '--line-3': '#6D8FBF', '--line-4': '#2F62C8' },
  },
  icons: LUNA_ICONS,
});

skin({
  id: 'hellscape', name: 'Hellscape',
  pitch: 'Brick, bevel and a status-bar HUD from the pit',
  swatch: 'linear-gradient(180deg, #7A1E12 0 18%, #2C130D 18% 100%)',
  theme: {
    accents: { reality: '#7BE05A', intent: '#6FB4FF', highlight: '#F2EEE6' },
    chassis: { hue: 28, tint: 4, brightness: 0.21, contrast: 1.15 },
    look: { glow: 1.2, radius: 0, scale: 1.12, numWeight: 600, motion: 6 },
    // Bevel edges in stone and bone; browns, never the hazard red.
    overrides: { '--line-1': '#6B3C2E', '--line-2': '#8A5240', '--line-3': '#A8705A', '--line-4': '#C9A48E' },
  },
  icons: PIXEL_ICONS,
});

skin({
  id: 'p1', name: 'P1 Terminal',
  pitch: 'Green phosphor, scanlines and a blinking cursor',
  swatch: 'repeating-linear-gradient(0deg, rgba(0, 0, 0, .5) 0 1px, transparent 1px 3px), #03200E',
  theme: {
    accents: { reality: '#3BFF7A', intent: '#8FE8F0', highlight: '#D4FFD8' },
    chassis: { hue: 150, tint: 4, brightness: 0.14, contrast: 1.1 },
    look: { glow: 1.7, radius: 0, scale: 1.12, numWeight: 400, motion: 8 },
  },
  icons: PIXEL_ICONS,
});

skin({
  id: 'platinum', name: 'Platinum',
  pitch: 'Pinstripe title bars and gray bevels, 1999 style',
  swatch: 'repeating-linear-gradient(0deg, #fff 0 1px, #B8B8BC 1px 2px) 0 0 / 100% 45% no-repeat, #D6D6D8',
  theme: {
    accents: { reality: '#2F4F9E', intent: '#6A2E92', highlight: '#3C3CAA' },
    chassis: { hue: 270, tint: 0.5, brightness: 0.86, contrast: 1 },
    look: { glow: 0, radius: 4, scale: 1.12, numWeight: 400, motion: 3 },
    overrides: { '--line-1': '#A6A6AA', '--line-2': '#7C7C82', '--line-3': '#5E5E64', '--line-4': '#2A2A2E' },
  },
  icons: PIXEL_ICONS,
});

skin({
  id: 'dmg', name: 'DMG',
  pitch: 'Four shades of pea-green LCD behind a pixel grid',
  swatch: 'linear-gradient(#0F380F 0 25%, #306230 25% 50%, #8BAC0F 50% 75%, #9BBC0F 75%)',
  theme: {
    accents: { reality: '#0F380F', intent: '#5E1240', highlight: '#1F2F7A' },
    chassis: { hue: 125, tint: 4, brightness: 0.72, contrast: 1 },
    look: { glow: 0, radius: 0, scale: 1.12, numWeight: 500, motion: 2 },
    // The four LCD tones, one step lighter for the value surface; text is the darkest tone.
    overrides: {
      '--bg': '#9BBC0F', '--bg-raised': '#9BBC0F', '--bg-card': '#A7C714', '--bg-sunken': '#8BAC0F', '--shell-bg': '#8BAC0F',
      '--line-0': '#8FB10D', '--line-1': '#4F7A14', '--line-2': '#306230', '--line-3': '#1D4A14', '--line-4': '#0F380F',
      '--tx-hi': '#0F380F', '--tx': '#0F380F', '--tx-val': '#0F380F', '--tx-mut': '#1D4A14', '--tx-ghost': '#25521A', '--tx-faint': '#5F8A1A',
      '--shade-rgb': '15,56,15',
    },
  },
  icons: PIXEL_ICONS,
});

skin({
  id: 'blueprint', name: 'Blueprint',
  pitch: 'White lines on drafting blue, grid paper and dashed frames',
  swatch: 'linear-gradient(rgba(255, 255, 255, .22) 1px, transparent 1px) 0 0 / 6px 6px, linear-gradient(90deg, rgba(255, 255, 255, .22) 1px, transparent 1px) 0 0 / 6px 6px, #0F3A68',
  theme: {
    accents: { reality: '#BFF0FF', intent: '#FFB8E6', highlight: '#FFFFFF' },
    chassis: { hue: 245, tint: 4, brightness: 0.3, contrast: 1.2 },
    look: { glow: 0.6, radius: 0, scale: 1.12, numWeight: 400, motion: 4 },
    overrides: {
      '--bg': '#0C3260', '--bg-raised': '#103C69', '--bg-card': '#10416F', '--bg-sunken': '#08254A', '--shell-bg': '#061D3A',
      '--line-0': '#0E3A6A', '--line-1': '#3A6FA6', '--line-2': '#5C90C4', '--line-3': '#7DB0E0', '--line-4': '#A9D2F5',
      '--tx-hi': '#FFFFFF', '--tx': '#DDEEFF', '--tx-val': '#BCDAF2', '--tx-mut': '#93BDE3', '--tx-ghost': '#86B0D6', '--tx-faint': '#2D5C8F',
    },
  },
  icons: {},
});

skin({
  id: 'outrun', name: 'Outrun',
  pitch: 'Neon pink and cyan over a sunset grid',
  swatch: 'linear-gradient(180deg, #0B0420 0 45%, #6A1B7A 72%, #FF4FD8 100%)',
  theme: {
    accents: { reality: '#00E5FF', intent: '#FF4FD8', highlight: '#9BFF4D' },
    chassis: { hue: 300, tint: 4, brightness: 0.16, contrast: 1 },
    look: { glow: 1.8, radius: 2, scale: 1.12, numWeight: 500, motion: 7 },
  },
  icons: {},
});

skin({
  id: 'rack', name: 'Rack',
  pitch: 'Brushed-metal rack gear with LED readouts',
  swatch: 'linear-gradient(180deg, #3A4146, #1E2326 55%, #111517)',
  theme: {
    accents: { reality: '#37F26B', intent: '#5AB8FF', highlight: '#FFFFFF' },
    chassis: { hue: 230, tint: 0.8, brightness: 0.22, contrast: 1.1 },
    look: { glow: 1.3, radius: 2, scale: 1.12, numWeight: 500, motion: 4 },
  },
  icons: {},
});

skin({
  id: 'amp', name: 'Amp',
  pitch: 'A skinned music player: bevels, LED digits, a grip-striped title bar',
  swatch: 'repeating-linear-gradient(90deg, #7A86B8 0 1px, transparent 1px 3px) 0 0 / 100% 35% no-repeat, linear-gradient(180deg, #3A4156, #1B1F2B)',
  theme: {
    accents: { reality: '#00E85A', intent: '#7FB0FF', highlight: '#E8E8E8' },
    chassis: { hue: 240, tint: 0.6, brightness: 0.17, contrast: 1.1 },
    look: { glow: 0.9, radius: 0, scale: 1.12, numWeight: 500, motion: 3 },
    overrides: { '--line-1': '#3A3F4C', '--line-2': '#5A6070', '--line-3': '#7A8296', '--line-4': '#A8B0C4' },
  },
  icons: PIXEL_ICONS,
});

skin({
  id: 'jelly', name: 'Jelly',
  pitch: 'Pinstripes, glossy capsules and blue jelly buttons',
  swatch: 'linear-gradient(180deg, rgba(255, 255, 255, .85), rgba(255, 255, 255, 0) 55%), linear-gradient(180deg, #5FA2F5, #1B64D4)',
  theme: {
    accents: { reality: '#1759C2', intent: '#8E3CC8', highlight: '#126B2F' },
    chassis: { hue: 250, tint: 0.5, brightness: 0.95, contrast: 1 },
    look: { glow: 0.25, radius: 8, scale: 1.12, numWeight: 400, motion: 3 },
    overrides: { '--line-1': '#CBD2DD', '--line-2': '#9AA6B8', '--line-3': '#7C8BA2', '--line-4': '#1B64D4' },
  },
  icons: JELLY_ICONS,
});

skin({
  id: 'setup', name: 'Setup',
  pitch: 'A BIOS blue screen: double-line boxes and a reverse-video cursor',
  swatch: 'linear-gradient(#0000AA, #0000AA) padding-box, #AAAAAA',
  theme: {
    accents: { reality: '#55FFFF', intent: '#FF9BFF', highlight: '#FFFFFF' },
    chassis: { hue: 265, tint: 4, brightness: 0.2, contrast: 1.1 },
    look: { glow: 0, radius: 0, scale: 1.12, numWeight: 500, motion: 0 },
    overrides: {
      '--bg': '#000080', '--bg-raised': '#0000AA', '--bg-card': '#0000AA', '--bg-sunken': '#000066', '--shell-bg': '#00004C',
      '--line-0': '#000080', '--line-1': '#5A5AD0', '--line-2': '#8A8AEA', '--line-3': '#AAAAAA', '--line-4': '#FFFFFF',
      '--tx-hi': '#FFFFFF', '--tx': '#EDEDED', '--tx-val': '#C8C8C8', '--tx-mut': '#A6A6F2', '--tx-ghost': '#9898E8', '--tx-faint': '#4A4AB8',
    },
  },
  icons: PIXEL_ICONS,
});

skin({
  id: 'boing', name: 'Boing',
  pitch: 'Gray gadgets and blue copper bars from a 1990 workstation',
  swatch: 'linear-gradient(180deg, #2A4F9C 0 40%, #AAAAAA 40% 100%)',
  theme: {
    accents: { reality: '#12306E', intent: '#44106A', highlight: '#123A58' },
    chassis: { hue: 230, tint: 1.2, brightness: 0.8, contrast: 1 },
    look: { glow: 0, radius: 0, scale: 1.12, numWeight: 500, motion: 2 },
    overrides: { '--line-1': '#8A8A92', '--line-2': '#5A5A64', '--line-3': '#2E2E36', '--line-4': '#000000', '--tx-val': '#2F3338', '--tx-mut': '#43484D', '--tx-ghost': '#464B50' },
  },
  icons: PIXEL_ICONS,
});

skin({
  id: 'cipher', name: 'Cipher',
  pitch: 'Falling green code behind glass-black panels',
  swatch: 'repeating-linear-gradient(90deg, rgba(0, 255, 65, .55) 0 1px, transparent 1px 5px), #010A03',
  theme: {
    accents: { reality: '#00FF41', intent: '#5CE1FF', highlight: '#E8FFE8' },
    chassis: { hue: 145, tint: 4, brightness: 0.09, contrast: 1.1 },
    look: { glow: 1.8, radius: 0, scale: 1.12, numWeight: 400, motion: 8 },
  },
  icons: PIXEL_ICONS,
});

skin({
  id: 'notebook', name: 'Notebook',
  pitch: 'Ruled paper, stitched cards and felt-pen icons',
  swatch: 'repeating-linear-gradient(180deg, transparent 0 4px, rgba(80, 120, 170, .45) 4px 5px), #F6F1E3',
  theme: {
    accents: { reality: '#1F5FA8', intent: '#8A3D7B', highlight: '#256B43' },
    chassis: { hue: 85, tint: 1.8, brightness: 0.94, contrast: 1 },
    look: { glow: 0, radius: 2, scale: 1.12, numWeight: 400, motion: 3 },
    overrides: { '--line-1': '#D9CDB4', '--line-2': '#B8A988', '--line-3': '#9A8A68', '--line-4': '#6E6046' },
  },
  icons: SKETCH_ICONS,
});

skin({
  id: 'contrast', name: 'Contrast',
  pitch: 'Black, white and cyan: thick frames, no texture, 7:1 text',
  swatch: 'linear-gradient(90deg, #000 0 50%, #fff 50% 55%, #000 55%)',
  theme: {
    accents: { reality: '#00FFFF', intent: '#E0A0FF', highlight: '#FFFFFF' },
    chassis: { hue: 0, tint: 0, brightness: 0, contrast: 2 },
    look: { glow: 0, radius: 0, scale: 1.12, numWeight: 600, motion: 1 },
    overrides: { '--line-1': '#767676', '--line-2': '#A0A0A0', '--line-3': '#C8C8C8', '--line-4': '#FFFFFF' },
  },
  icons: {},
});

skin({
  id: 'mica', name: 'Mica',
  pitch: 'Fluent: Windows 11 Mica behind 8 px cards and hairline strokes',
  note: 'Mica: Windows 11; elsewhere an opaque look',
  material: 'mica',
  wallpaper: false,
  swatch: 'linear-gradient(135deg, #3A3F4B, #1E2026)',
  theme: {
    accents: { reality: '#60CDFF', intent: '#CBA6FF', highlight: '#8AB4FF' },
    chassis: { hue: 255, tint: 0.5, brightness: 0.17, contrast: 1.05 },
    look: { glow: 0.5, radius: 4, scale: 1.12, numWeight: 400, motion: 4 },
    // White strokes at 4 to 40%: the same lines on Mica and on the opaque fallback. Labels
    // are pinned bright so they hold 3:1 under the 82% tint at the lightest dark Mica.
    overrides: {
      '--line-0': '#FFFFFF0D', '--line-1': '#FFFFFF17', '--line-2': '#FFFFFF26', '--line-3': '#FFFFFF40', '--line-4': '#FFFFFF66',
      '--tx-val': '#C9CDD6', '--tx-mut': '#AEB3BF', '--tx-ghost': '#A0A6B3',
    },
  },
  icons: FLUENT_ICONS,
});

skin({
  id: 'glass', name: 'Liquid Glass',
  pitch: 'Capsules, specular rims and layered glass over your wallpaper',
  note: 'Liquid Glass: macOS 26 system glass, Windows Acrylic; elsewhere a blurred in-page backdrop',
  material: 'glass',
  wallpaper: true,
  swatch: 'radial-gradient(circle at 25% 20%, rgba(255, 255, 255, .55), transparent 45%), linear-gradient(135deg, #5E5CE6, #0A84FF 55%, #30D1BE)',
  theme: {
    accents: { reality: '#5AC8FA', intent: '#D9A0FF', highlight: '#FFFFFF' },
    chassis: { hue: 250, tint: 0.8, brightness: 0.14, contrast: 1.05 },
    look: { glow: 0.7, radius: 14, scale: 1.12, numWeight: 400, motion: 4 },
    // Labels pinned bright: they hold 3:1 under the 96% tint over a white backdrop.
    overrides: { '--tx-val': '#CBD0DA', '--tx-mut': '#B4BAC6', '--tx-ghost': '#A8AEBB' },
  },
  icons: GLASS_ICONS,
});

skin({
  id: 'material', name: 'Material',
  pitch: 'Material 3: tonal surfaces, state layers, pill buttons; Material You colors on Android',
  note: 'Material: on Android 12 and later the colors come from your wallpaper; elsewhere the baseline palette',
  swatch: 'linear-gradient(135deg, #D0BCFF 0 34%, #2B2733 34% 100%)',
  theme: {
    // The M3 baseline in its dark scheme. The tertiary pink of the baseline is a red hue, so the
    // intent accent is a cool cyan instead (the safety hue check, THEMES.md).
    accents: { reality: '#D0BCFF', intent: '#9BD6E8', highlight: '#EADDFF' },
    chassis: { hue: 300, tint: 1.8, brightness: 0.2, contrast: 1 },
    look: { glow: 0, radius: 12, scale: 1.12, numWeight: 400, motion: 4 },
    // M3 outline and outline-variant, on the neutral surface.
    overrides: { '--line-1': '#49454F', '--line-2': '#79747E', '--line-3': '#938F99', '--line-4': '#CAC4D0' },
  },
  icons: ROUND_ICONS,
});
