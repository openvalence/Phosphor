/**
 * copy-lint.mjs -- the mechanical half of docs/COPY.md. Fails on a literal
 * title=, data-tip= or placeholder= string in src/ that is over 60
 * characters, holds a second sentence (". "), or uses a story word.
 *
 * Constraints:
 * - Only string LITERALS are checked. A value bound from a variable (the
 *   catalog's desc, a ladder reason) carries no literal and is skipped: hub
 *   text is the hub's copy, and reasons are checked where they are written.
 * - A literal concatenated with values is checked fragment by fragment, so a
 *   fragment's length is a floor on the rendered length, never the total.
 *
 * Run: node test/copy-lint.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAX = 60;
const BANNED = [/\. /, /\bso that\b/i, /\ballows you\b/i, /\bsimply\b/i, /\bjust\b/i, /\bin order to\b/i];

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(svelte|js)$/.test(n)) out.push(p);
  }
  return out;
}

/** The text of the balanced `{...}` starting at s[i], strings skipped whole. */
function braced(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '"' || c === "'" || c === '`') { j = skipString(s, j); continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return s.slice(i + 1, j);
  }
  return s.slice(i + 1);
}
function skipString(s, i) {
  const q = s[i];
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === q) return j;
  }
  return s.length;
}

/** Every string literal in a JS expression; a template's static chunks only. */
function literals(expr) {
  const out = [];
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c !== '"' && c !== "'" && c !== '`') continue;
    const end = skipString(expr, i);
    const body = expr.slice(i + 1, end).replace(/\\(.)/g, '$1');
    out.push(...(c === '`' ? body.split(/\$\{[^}]*\}/) : [body]));
    i = end;
  }
  return out;
}

const findings = [];
for (const file of walk(join(ROOT, 'src'))) {
  const s = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const re = /(?<=\s)(title|data-tip|placeholder)=(["{])/g;
  for (let m; (m = re.exec(s));) {
    const at = m.index + m[0].length - 1;
    const parts = m[2] === '{' ? literals(braced(s, at))
      : s.slice(at + 1, skipString(s, at)).split(/\{[^}]*\}/);
    const line = s.slice(0, m.index).split('\n').length;
    for (const t of parts.map((x) => x.trim()).filter(Boolean)) {
      const why = t.length > MAX ? 'over ' + MAX + ' characters'
        : BANNED.find((b) => b.test(t)) ? 'story copy (' + BANNED.find((b) => b.test(t)).source + ')' : '';
      if (why) findings.push(rel + ':' + line + ' ' + m[1] + ': ' + why + ': "' + t + '"');
    }
  }
}

for (const f of findings) console.log('  [FAIL] ' + f);
console.log(findings.length ? '\nFAIL -- ' + findings.length + ' tooltip/placeholder string(s) break docs/COPY.md'
  : 'PASS -- every literal tooltip and placeholder reads as one short fragment');
process.exit(findings.length ? 1 : 0);
