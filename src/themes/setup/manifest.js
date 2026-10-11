import icons from './icons.js';

// The VGA text-mode palette, pinned per Variant: surfaces, the line ramp and the text ramp. Every
// one reads 4.5:1 (text) or 3:1 (labels) on its own surfaces; the kit measures the pages.
const pin = (bg, sunken, line, tx) => ({
  '--bg': bg, '--bg-raised': bg, '--bg-card': bg, '--bg-sunken': sunken,
  '--line-0': line[0], '--line-1': line[1], '--line-2': line[2], '--line-3': line[3], '--line-4': line[4],
  '--tx-hi': tx[0], '--tx': tx[1], '--tx-val': tx[2], '--tx-mut': tx[3], '--tx-ghost': tx[4], '--tx-faint': tx[5],
});
const look = { glow: 0, radius: 0, scale: 1.12, numWeight: 400, motion: 2 };

export default {
  id: 'setup', name: 'Setup',
  pitch: 'A BIOS setup screen: blue, double-line boxes, gray dialogs, reverse video',
  swatch: 'linear-gradient(#AAAAAA, #AAAAAA) top / 100% 24% no-repeat, linear-gradient(#AAAAAA, #AAAAAA) bottom / 100% 20% no-repeat, #0000AA',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'setup',
      name: 'Setup',
      accents: { reality: '#55FFFF', intent: '#FF55FF', highlight: '#FFFFFF' },
      chassis: { hue: 265, tint: 4, brightness: 0.2, contrast: 1.1 },
      look,
      overrides: pin('#0000AA', '#000080', ['#000080', '#5555FF', '#8A8AFF', '#AAAAAA', '#FFFFFF'],
        ['#FFFFFF', '#EDEDED', '#FFFF55', '#AAAAAA', '#8C8CFF', '#5555FF']),
    },
    {
      id: 'setup-red',
      name: 'Red',
      accents: { reality: '#55FFFF', intent: '#FF9BFF', highlight: '#FFFFFF' },
      chassis: { hue: 25, tint: 3, brightness: 0.14, contrast: 1.1 },
      look,
      // A dark red, not VGA #AA0000: the safety red must stay 4.5:1 on the surface it prints on (law 13).
      overrides: pin('#480000', '#2E0000', ['#380000', '#8C3C3C', '#BB7777', '#AAAAAA', '#FFFFFF'],
        ['#FFFFFF', '#F4E8E8', '#FFFF55', '#E0B8B8', '#CC9090', '#8C3C3C']),
    },
    {
      id: 'setup-mono',
      name: 'Mono',
      accents: { reality: '#FFFFFF', intent: '#BDBDBD', highlight: '#FFFFFF' },
      chassis: { hue: 0, tint: 0, brightness: 0.05, contrast: 1.1 },
      look,
      overrides: pin('#000000', '#0C0C0C', ['#1C1C1C', '#555555', '#7A7A7A', '#AAAAAA', '#FFFFFF'],
        ['#FFFFFF', '#E6E6E6', '#FFFFFF', '#AAAAAA', '#8A8A8A', '#555555']),
    },
  ],
};
