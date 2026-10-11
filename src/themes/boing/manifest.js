import icons from './icons.js';
import { variant } from '../kit.js';

const look = { glow: 0, radius: 0, scale: 1.12, numWeight: 400, motion: 2 };

export default {
  id: 'boing', name: 'Boing',
  pitch: 'A 16-bit desktop: bevels, pixel type, a bouncing ball',
  swatch: 'linear-gradient(180deg, #4A68A4 0 34%, #AAAAAA 34% 100%)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    variant('boing', 'Gray 2.0', '#08246B', '#4A1470',
      { hue: 250, tint: 0, brightness: 0.72, contrast: 0.6 },
      { highlight: '#0A2A8E', look, overrides: {
        '--bg': '#A0A0A0', '--bg-raised': '#AAAAAA', '--bg-card': '#AAAAAA', '--bg-sunken': '#939393', '--shell-bg': '#4A68A4', '--shell-fg': '#FFFFFF',
        '--line-0': '#7C7C7C', '--line-1': '#555555', '--line-2': '#3A3A3A', '--line-3': '#202020', '--line-4': '#000000',
        '--tx-hi': '#000000', '--tx': '#0A0A0A', '--tx-val': '#1A1A1A', '--tx-mut': '#262626', '--tx-ghost': '#2C2C2C', '--tx-faint': '#808080',
      } }),
    variant('boing-13', 'Blue 1.3', '#7FD0FF', '#FF9020',
      { hue: 258, tint: 2, brightness: 0.26, contrast: 0.5 },
      { highlight: '#FF9020', look, overrides: {
        '--bg': '#003A78', '--bg-raised': '#003A78', '--bg-card': '#003A78', '--bg-sunken': '#002350', '--shell-bg': '#003A78',
        '--line-0': '#002A58', '--line-1': '#3F72B8', '--line-2': '#6C9BDA', '--line-3': '#9CBDEA', '--line-4': '#FFFFFF',
        '--tx-hi': '#FFFFFF', '--tx': '#F2F6FF', '--tx-val': '#DCE8FF', '--tx-mut': '#B4CEF4', '--tx-ghost': '#9FC0F0', '--tx-faint': '#2E5C9C',
      } }),
    variant('boing-31', 'Gradient 3.1', '#0A2A80', '#5A1A8C',
      { hue: 250, tint: 0.4, brightness: 0.78, contrast: 0.6 },
      { highlight: '#0A2F94', look, overrides: {
        '--bg': '#B8BCC8', '--bg-raised': '#C4C7D2', '--bg-card': '#CCCFD9', '--bg-sunken': '#A4A9B8', '--shell-bg': '#1F4FB8', '--shell-fg': '#FFFFFF',
        '--line-0': '#9CA1B2', '--line-1': '#7A7F96', '--line-2': '#5A5F78', '--line-3': '#3A3E55', '--line-4': '#1A1E34',
        '--tx-hi': '#000000', '--tx': '#0C0F1E', '--tx-val': '#1C2038', '--tx-mut': '#2E3350', '--tx-ghost': '#343959', '--tx-faint': '#8088A0',
      } }),
  ],
};
