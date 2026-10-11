import icons from './icons.js';

export default {
  id: 'rack', name: 'Rack',
  pitch: 'Studio rack gear: brushed aluminum, knobs, LED meters',
  swatch: 'linear-gradient(180deg, #D3D8DC 0 22%, #1B2023 22% 100%), radial-gradient(circle at 70% 70%, #37F26B 0 18%, transparent 20%)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'rack',
      name: 'Rack',
      accents: { reality: '#37F26B', intent: '#5AB8FF', highlight: '#FFFFFF' },
      chassis: { hue: 230, tint: 0.8, brightness: 0.17, contrast: 1.1 },
      look: { glow: 1.3, radius: 2, scale: 1.12, numWeight: 500, motion: 4 },
    },
    {
      id: 'rack-vintage',
      name: 'Vintage',
      accents: { reality: '#126239', intent: '#3F49A8', highlight: '#0E5FA3' },
      chassis: { hue: 88, tint: 3.4, brightness: 0.91, contrast: 1 },
      look: { glow: 0.5, radius: 3, scale: 1.12, numWeight: 500, motion: 3 },
    },
    {
      id: 'rack-modular',
      name: 'Modular',
      accents: { reality: '#35F0B0', intent: '#B38DFF', highlight: '#4DD6FF' },
      chassis: { hue: 252, tint: 0.5, brightness: 0.19, contrast: 1.2 },
      look: { glow: 1.2, radius: 3, scale: 1.12, numWeight: 500, motion: 4 },
    },
  ],
};
