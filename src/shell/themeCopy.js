/**
 * themeCopy.js -- the names of the Display pane's accents and knobs, shared by
 * ThemePicker (the rows) and settingsSearch.js (the F3 entries), so a row
 * cannot gain a name F3 does not know.
 */
export const ACCENTS = [
  ['reality', 'Reality', 'Measured truth'],
  ['intent', 'Intent', 'Requested, not yet confirmed'],
  ['highlight', 'Highlight', 'Focus, selection, hover'],
];

// key: [label, tooltip]; the value formats stay with the pane.
export const KNOB_NAMES = {
  hue: ['Hue', 'Chassis hue'],
  tint: ['Tint', 'Chassis color strength'],
  brightness: ['Brightness', 'Page lightness'],
  contrast: ['Contrast', 'Ramp spread'],
  glow: ['Glow', 'Glow strength'],
  radius: ['Radius', 'Corner radius'],
  scale: ['Scale', 'Control scale'],
  numWeight: ['Numerals', 'Readout numeral weight'],
  motion: ['Afterglow', 'Echo afterglow; 0 holds still'],
};
