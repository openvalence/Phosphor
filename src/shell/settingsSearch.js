/**
 * settingsSearch.js -- the Display and Settings entries F3 lists
 * (ui/searchIndex.js). `key` is the row's data-search-key in ThemePicker or
 * SettingsPane; `shell` marks a row that exists only in the Settings pane.
 * `settingsEntries(presets)` adds the generated ones: every accent and knob
 * (themeCopy.js) and each theme preset by its id.
 */
import { ACCENTS, KNOB_NAMES } from './themeCopy.js';

const PHONE = ['android', 'ios'].includes(import.meta.env?.TAURI_ENV_PLATFORM);

const FIXED = [
  { label: 'Theme', key: 'theme' },
  { label: 'Accents', key: 'accents' },
  { label: 'Chassis', key: 'chassis' },
  { label: 'Look', key: 'look' },
  { label: 'Advanced token overrides', key: 'tokens' },
  { label: 'Export or import a theme', key: 'theme-io' },
  { label: 'Legibility', key: 'legibility' },
  { label: 'High legibility', key: 'hivis' },
  { label: 'Terse instruments', key: 'terse' },
  { label: 'Scrollbars', key: 'scrollbars' },
  { label: 'Motion: system, reduced, full', key: 'motion' },
  { label: 'Rail hide tab', key: 'railhide' },
  { label: 'Units', key: 'units' },
  { label: 'Autorange', key: 'autorange' },
  { label: 'Renderer class', key: 'class' },
  { label: 'Reconnect to the last hub on launch', key: 'reconnect', shell: true },
  { label: 'Broadcast e-stop to every hub on the LAN', key: 'estop-broadcast', shell: true },
  { label: 'Telemetry rate', key: 'telemetry-rate', shell: true },
  ...(PHONE ? [] : [{ label: 'Close immediately when idle', key: 'close-idle', shell: true }]),
  ...(PHONE ? [] : [{ label: 'Open to LAN', key: 'open-to-lan', shell: true }]),
  { label: 'Backup and restore', key: 'backup', shell: true },
];

export const settingsEntries = (presets = []) => [
  ...FIXED,
  ...ACCENTS.map(([k, label]) => ({ label: label + ' accent', key: 'accent-' + k })),
  ...Object.entries(KNOB_NAMES).map(([k, [label, tip]]) => ({ label: label + ': ' + tip.toLowerCase(), key: 'knob-' + k })),
  ...presets.map((p) => ({ label: 'Theme: ' + p.name, key: 'theme-' + p.id })),
];
