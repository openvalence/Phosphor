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
import { LUNA_ICONS, PIXEL_ICONS } from './icons.js';

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
