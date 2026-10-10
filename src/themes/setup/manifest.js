import icons from './icons.js';

export default {
  id: 'setup', name: 'Setup',
  pitch: 'A BIOS blue screen: double-line boxes and a reverse-video cursor',
  swatch: 'linear-gradient(#0000AA, #0000AA) padding-box, #AAAAAA',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'setup',
      name: 'Setup',
      accents: { reality: '#55FFFF', intent: '#FF9BFF', highlight: '#FFFFFF' },
      chassis: { hue: 265, tint: 4, brightness: 0.2, contrast: 1.1 },
      look: { glow: 0, radius: 0, scale: 1.12, numWeight: 500, motion: 0 },
      overrides: {
        '--bg': '#000080',
        '--bg-raised': '#0000AA',
        '--bg-card': '#0000AA',
        '--bg-sunken': '#000066',
        '--shell-bg': '#00004C',
        '--line-0': '#000080',
        '--line-1': '#5A5AD0',
        '--line-2': '#8A8AEA',
        '--line-3': '#AAAAAA',
        '--line-4': '#FFFFFF',
        '--tx-hi': '#FFFFFF',
        '--tx': '#EDEDED',
        '--tx-val': '#C8C8C8',
        '--tx-mut': '#A6A6F2',
        '--tx-ghost': '#9898E8',
        '--tx-faint': '#4A4AB8',
      },
    },
  ],
};
