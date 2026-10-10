import { variant } from '../kit.js';
import icons from './icons.js';

// The default style: style.css and the engine's knobs, no stylesheet layer of its own. Its
// variants are the pure recolors, each a palette on the same chrome.
export default {
  id: 'phosphor', name: 'Phosphor',
  pitch: 'The instrument: flat panels, hairlines, phosphor glow',
  swatch: 'linear-gradient(135deg, #4DA6FF 0 28%, #08090B 28% 100%)',
  icons,
  variants: [
    // A highlight of its own (2026-10-04): with the reality fallback the planner line and the heat ramp's top read as the position trace.
    variant('phosphor', 'Phosphor', '#4DA6FF', '#A78BFA', {}, { highlight: '#FF5CB3' }),
    variant('tracer', 'Tracer', '#52E88C', '#E85CFF'),
    variant('synth', 'Synth', '#FF5CA8', '#5CE8FF'),
    variant('ember', 'Ember', '#FF8A4D', '#4CCEFE'),
    variant('arctic', 'Arctic', '#7DE8FF', '#C4B5FD'),
    variant('vapor', 'Vapor', '#B78BFF', '#FF8BD1'),
    variant('ultra', 'Ultra', '#8B7BFF', '#4DFFC4'),
    variant('sakura', 'Sakura', '#FFA8C5', '#A8D8FF'),
    variant('stealth', 'Stealth', '#D8DEE8', '#8A93A6'),
    variant('slate', 'Slate', '#5CC8FF', '#9D8BFA', { hue: 245, tint: 2.4, brightness: 0.2, contrast: 1 }),
    variant('ink', 'Warm ink', '#66D5BA', '#E8A0FF', { hue: 60, tint: 1.8, brightness: 0.15, contrast: 1.05 }),
    variant('paper', 'Paper', '#1A66C8', '#6A3FC8', { hue: 263, tint: 1, brightness: 0.97, contrast: 1 }),
  ],
};
