/**
 * spacing-lint.mjs -- raw px spacing is banned in components (ph-acnj).
 *
 * Fails on padding, margin, gap and inset values written in px, in
 * src/App.svelte, src/style.css, src/ui, src/shell and plugins/factory, and on
 * grid-template-columns in src/ui/hero and plugins/factory. Spacing comes from
 * --sp-1..--sp-5 / --gap (style.css), so it follows the UI scale.
 *
 * Constraints:
 * - 0 and 1 px hairlines (and -1px overlaps) are always allowed.
 * - Anything else needs a line in ALLOW below: file, a substring of the
 *   declaration, and the reason. A stale entry fails too, so the list cannot rot.
 *
 * Run: node test/spacing-lint.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SCAN = ['src/App.svelte', 'src/style.css', 'src/ui', 'src/shell', 'plugins/factory'];
const GRID_DIRS = ['src/ui/hero/', 'plugins/factory/'];
const ALLOW = [
  // [file substring, line substring, reason]
  ['src/style.css', 'inset: -3px', 'the field ring: 3 px out, fixed geometry the safety suite asserts'],
  ['src/ui/Field.svelte', 'inset: -4px', 'the locate sweep: 3 px ring plus the 1 px line'],
  ['src/ui/Field.svelte', 'margin: -11px 0', 'coarse hit box: 40 px box over an 18 px footprint'],
  ['src/ui/Field.svelte', 'inset: 11px', 'coarse hit box: the visible square inside the 40 px box'],
  ['src/ui/Field.svelte', 'padding: 10px 0', 'coarse hit box: the chip reaches the 40 px floor'],
  ['src/ui/Field.svelte', 'row-gap: 11px', 'coarse hit box reach'],
  ['src/ui/dash/DashItem.svelte', '- 40px', 'centers the 40 px (--tap floor) head control'],
  ['src/ui/hero/HeroNumerals.svelte', '- 40px', 'centers the 40 px (--tap floor) numeral control'],
  ['src/ui/hero/HeroNumerals.svelte', 'grid-template-columns: max-content', 'the numerals are one content-sized readout, not a card body'],
  ['src/ui/pane.css', 'var(--pane-head-h) + 10px', 'lifted pane head: a 10 px gap clear of the 4 px panel outline'],
  ['src/ui/pane.css', 'var(--pane-head-h) + 21px', 'lifted pane head: 12 px padding, 1 px frame and the 11 px top inset'],
  ['src/ui/TopStrip.svelte', '+ 64px +', 'the strip clears the 64 px mini rail'],
  ['funscript-player/', 'grid-template-columns', 'the player is its own composition (compositionOf), rows of ch-sized label, slider and value tracks'],
  ['funscript-player/', 'margin-top: -9px', 'slider hit area: the thumb centers on a 40 px row'],
  ['funscript-player/timeline.js', 'inset: -8px 0', 'a pointer hit extension of the 24 px strip'],
  ['funscript-player/ui.js', 'inset: -4px 0', 'a pointer hit extension of the scrub bar'],
];

const files = [];
const walk = (p) => {
  const st = statSync(join(ROOT, p));
  if (st.isDirectory()) { for (const n of readdirSync(join(ROOT, p))) walk(p + '/' + n); return; }
  if (/\.(svelte|css|js)$/.test(p) && !p.endsWith('.test.mjs')) files.push(p);
};
for (const p of SCAN) walk(p);

const PROP = /(?<![\w-])((?:padding|margin)(?:-[a-z]+)?|gap|column-gap|row-gap|inset(?:-[a-z]+)?)\s*:\s*([^;{}]*)/g;
const rawPx = (v) => {
  let depth = 0, out = [];
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '(') depth++; else if (v[i] === ')') depth--;
    if (/[\d.]/.test(v[i]) && !/[\w.]/.test(v[i - 1] || ' ') || (v[i] === '-' && /\d/.test(v[i + 1] || ''))) {
      const m = /^-?\d*\.?\d+px(?![\w])/.exec(v.slice(i));
      if (m) { const n = parseFloat(m[0]); if (![0, 1, -1].includes(n)) out.push(m[0]); i += m[0].length - 1; }
    }
  }
  return out;
};

const findings = [];
const used = new Set();
const allowed = (file, text) => {
  const k = ALLOW.findIndex(([f, d]) => file.includes(f) && text.includes(d));
  if (k >= 0) used.add(k);
  return k >= 0;
};
for (const f of files) {
  const src = readFileSync(join(ROOT, f), 'utf8');
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
    for (const m of line.matchAll(PROP)) {
      const bad = rawPx(m[2]);
      if (bad.length && !allowed(f, line)) findings.push(f + ':' + (i + 1) + '  ' + m[1] + ': ' + m[2].trim() + '   [' + bad.join(' ') + ']');
    }
    if (GRID_DIRS.some((d) => f.startsWith(d)) && /grid-template-columns\s*:/.test(line) && !allowed(f, line)) {
      findings.push(f + ':' + (i + 1) + '  ' + line.trim());
    }
  });
}
ALLOW.forEach(([f, d], k) => { if (!used.has(k)) findings.push('stale allowance: ' + f + ' ~ ' + d); });

// Self-check: a planted 'padding: 6px' is caught.
const planted = [...'a { padding: 6px; }'.matchAll(PROP)].some((m) => rawPx(m[2]).length);
if (!planted) findings.push('self-check: the lint missed a planted padding: 6px');

for (const f of findings) console.log('  [FAIL] ' + f);
console.log(findings.length ? '\nFAILURES: ' + findings.length : 'ALL PASS -- no raw px spacing outside the allowance list (' + files.length + ' files)');
process.exit(findings.length ? 1 : 0);
