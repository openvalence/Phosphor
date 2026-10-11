import icons from './icons.js';
import { variant } from '../kit.js';

/** A phosphor's text ramp: one hue stepping down in brightness, the way a monochrome tube reads. */
function ramp(h, s) {
  const hex = (l, sat = s) => {
    const a = (sat / 100) * Math.min(l, 100 - l) / 100;
    const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
    return '#' + f(0) + f(8) + f(4);
  };
  return { '--tx-hi': hex(91, 100), '--tx': hex(70, s * .9), '--tx-val': hex(57, s * .85), '--tx-mut': hex(46, s * .75), '--tx-ghost': hex(41, s * .7) };
}

const LOOK = { glow: 1.7, radius: 0, scale: 1.12, numWeight: 400, motion: 8 };
const BLACK = { tint: 3, brightness: 0.09, contrast: 1.1 };

export default {
  id: 'p1', name: 'P1 Terminal',
  pitch: 'A green phosphor tube: glow, scanlines, a rolling band and a cursor',
  swatch: 'radial-gradient(ellipse at 50% 40%, rgba(59, 255, 122, .45), transparent 70%), repeating-linear-gradient(0deg, rgba(0, 0, 0, .55) 0 1px, transparent 1px 3px), #020A04',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    variant('p1', 'P1 Green', '#33FF66', '#A6FFD0', { hue: 145, ...BLACK }, { highlight: '#E6FFEA', look: LOOK, overrides: ramp(135, 85) }),
    // P3 amber: an orange amber, kept clear of the safety amber's hue so a warning never reads as the theme's own ink.
    variant('p1-amber', 'P3 Amber', '#FF8F2E', '#FFF4DC', { hue: 70, ...BLACK, tint: 2 }, { highlight: '#FFF0DC', look: LOOK, overrides: ramp(32, 100) }),
    variant('p1-white', 'P4 White', '#EAF2FF', '#9CCBFF', { hue: 240, ...BLACK, tint: 0.4 }, { highlight: '#FFFFFF', look: { ...LOOK, glow: 1.3 }, overrides: ramp(220, 25) }),
  ],
};
