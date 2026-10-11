import icons from './icons.js';
import { variant } from '../kit.js';

export default {
  id: 'glass', name: 'Liquid Glass',
  pitch: 'Capsules, specular rims and layered glass over your wallpaper',
  note: 'Liquid Glass: your desktop wallpaper is the backdrop where the app can read it (macOS 26 system glass, Windows Acrylic and a blurred in-page backdrop otherwise). Edge refraction by an SVG displacement filter, drawn here from the published technique; Chromium only.',
  material: 'glass',
  wallpaper: true,
  swatch: 'radial-gradient(circle at 25% 20%, rgba(255, 255, 255, .55), transparent 45%), linear-gradient(135deg, #5E5CE6, #0A84FF 55%, #30D1BE)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    variant('glass', 'Liquid Glass', '#5AC8FA', '#D9A0FF',
      { hue: 250, tint: 0.8, brightness: 0.14, contrast: 1.05 },
      { highlight: '#FFFFFF', look: { glow: 0.7, radius: 14, scale: 1.12, numWeight: 400, motion: 4 },
        overrides: { '--tx-val': '#CBD0DA', '--tx-mut': '#B4BAC6', '--tx-ghost': '#A8AEBB' } }),
    // Clear: the most see-through pane, a cooler and brighter accent, a lit rim.
    variant('glass-clear', 'Clear', '#7DE8FF', '#E3B8FF',
      { hue: 235, tint: 0.5, brightness: 0.12, contrast: 1.1 },
      { highlight: '#FFFFFF', look: { glow: 0.9, radius: 14, scale: 1.12, numWeight: 400, motion: 4 },
        overrides: { '--tx-val': '#D6DAE4', '--tx-mut': '#BDC3CF', '--tx-ghost': '#B0B7C4' } }),
    // Tinted: the glass takes the accent; a plum chassis, violet and aqua.
    variant('glass-tinted', 'Tinted', '#C4A8FF', '#7FE8D8',
      { hue: 305, tint: 1.5, brightness: 0.15, contrast: 1.05 },
      { highlight: '#FFE8FF', look: { glow: 0.8, radius: 14, scale: 1.12, numWeight: 400, motion: 4 },
        overrides: { '--tx-val': '#D9CFE6', '--tx-mut': '#BEB2CE', '--tx-ghost': '#B0A3C2' } }),
  ],
};
