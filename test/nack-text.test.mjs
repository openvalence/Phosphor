// nack-text.test.mjs -- every registry NACK code has user text or falls back on purpose (null),
// and the user text meets the copy rules (docs/COPY.md, Nucleus .claude/rules/strings.md).
// Run: node test/nack-text.test.mjs
import { NACK_TEXT, nackMeaning } from '../src/model/nack-text.js';
import { NACK_MEANING } from '../src/model/registry-tables.js';

let fails = 0;
const ok = (name, cond, info) => { console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || info == null ? '' : ' ' + JSON.stringify(info))); if (!cond) fails++; };
const hex = (c) => '0x' + Number(c).toString(16);

const codes = Object.keys(NACK_MEANING).map(Number);
const missing = codes.filter((c) => !(c in NACK_TEXT));
ok('every registry code has user text or a deliberate null', !missing.length, missing.map(hex));
const stray = Object.keys(NACK_TEXT).map(Number).filter((c) => !(c in NACK_MEANING));
ok('no user text for a code the registry lacks', !stray.length, stray.map(hex));
const texts = Object.values(NACK_TEXT).filter((t) => t !== null);
const bad = texts.filter((t) => /—|\.$|\. |\bplease\b|\bsimply\b|\bjust\b|\bsuccessfully\b/i.test(t) || !/^[A-Z]/.test(t));
ok('user text: capitalized fragment, no period, em dash or filler', !bad.length, bad);
ok('user text wins', nackMeaning(0x401) === NACK_TEXT[0x401] && NACK_TEXT[0x401] !== NACK_MEANING[0x401]);
const nulls = Object.entries(NACK_TEXT).filter(([, t]) => t === null).map(([c]) => Number(c));
ok('a null falls back to the registry note', nulls.every((c) => nackMeaning(c) === NACK_MEANING[c]), nulls.map(hex));
ok('an unknown code reads empty', nackMeaning(0xfff) === '');

console.log(fails ? '\nFAIL (' + fails + ')' : '\nALL PASS');
process.exit(fails ? 1 : 0);
