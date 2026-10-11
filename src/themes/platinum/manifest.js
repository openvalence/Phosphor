import icons from './icons.js';

export default {
  id: 'platinum', name: 'Platinum',
  pitch: 'Pinstriped title bars, bevelled gray windows and a woven desktop, 1999 style',
  swatch: 'linear-gradient(180deg, #FFF 0 1px, #A4A4AC 1px 2px, #FFF 2px 3px, #A4A4AC 3px 4px, #FFF 4px 5px, #A4A4AC 5px 6px, #DEDEE2 6px 8px, #DEDEE2 8px 100%) 0 0 / 100% 38% no-repeat, linear-gradient(180deg, #DEDEE2 38%, #C6C6CC 38% 100%)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'platinum',
      name: 'Platinum',
      accents: { reality: '#2A4590', intent: '#6A2E92', highlight: '#3C3CAA' },
      chassis: { hue: 270, tint: 0.5, brightness: 0.86, contrast: 1 },
      look: { glow: 0, radius: 4, scale: 1.12, numWeight: 400, motion: 3 },
      overrides: { '--bg': '#B7BFCE', '--tx-mut': '#46484E', '--tx-ghost': '#50535A', '--line-1': '#8E8E96', '--line-2': '#7A7A82', '--line-3': '#5E5E64', '--line-4': '#2A2A2E' },
    },
    {
      id: 'platinum-graphite',
      name: 'Graphite',
      accents: { reality: '#2F3A5A', intent: '#6A2E92', highlight: '#404658' },
      chassis: { hue: 250, tint: 0.35, brightness: 0.84, contrast: 1 },
      look: { glow: 0, radius: 4, scale: 1.12, numWeight: 400, motion: 3 },
      overrides: { '--bg': '#A9AFBA', '--tx-mut': '#3C3E44', '--tx-ghost': '#484B52', '--line-1': '#858892', '--line-2': '#73767F', '--line-3': '#585B64', '--line-4': '#26282E' },
    },
  ],
};
