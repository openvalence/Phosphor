/**
 * registry.js -- the registered themes as a list: the default style first, the others by name.
 * Pure: node tests import it with theme.js.
 */
import * as all from './index.js';

export const THEME_LIST = Object.freeze(Object.values(all).sort((a, b) => (a.id === 'phosphor' ? -1 : b.id === 'phosphor' ? 1 : a.name.localeCompare(b.name))));
