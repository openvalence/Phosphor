/**
 * main.js -- the Neutrino dev tool's page: Phosphor's tokens, fonts and themes, then the one window.
 */
import { mount } from 'svelte';
import App from './App.svelte';
import '../src/style.css';
import '../src/themes/fonts.css';
import { applyStoredTheme, onTheme } from '../src/model/theme.js';
import { installTips } from '../src/ui/tip.js';

// Only the applied Theme's sheet is in the document (Phosphor's main.js, docs/THEMES.md Performance).
const THEME_CSS = import.meta.glob('../src/themes/*/theme.css', { eager: true, query: '?inline', import: 'default' });
const sheet = document.head.appendChild(document.createElement('style'));
let style = null;
onTheme((t) => {
  if (t.style === style) return;
  style = t.style;
  sheet.textContent = THEME_CSS['../src/themes/' + t.style + '/theme.css'] || '';
});
applyStoredTheme();
installTips();

mount(App, { target: document.getElementById('app') });
