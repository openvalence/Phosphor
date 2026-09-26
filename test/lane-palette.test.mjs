/**
 * lane-palette.test.mjs -- a chart lane must never render in a hazard color.
 *
 * webui.md: --warn amber and --bad red are hazard semantics, identical in
 * every theme; using them decoratively (a lane picked by declaration order,
 * not meaning) is a safety defect, not a palette choice. ph-vdk.34: a sim
 * catalog's Speed lane landed on --bad red because TelemetryChart cycled
 * through PALETTE_VARS = ['--reality', '--good', '--warn', '--bad'].
 *
 * Device-free: reads the PALETTE_VARS source array and style.css's token
 * values directly, no browser and no hub.
 *
 * Run: node test/lane-palette.test.mjs
 */

import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  -- ' + extra : ''));
  if (!cond) fails++;
};

const chartSrc = readFileSync(new URL('../src/ui/widgets/TelemetryChart.svelte', import.meta.url), 'utf8');
const cssSrc = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

const m = chartSrc.match(/const PALETTE_VARS = (\[[^\]]*\]);/);
ok('TelemetryChart declares PALETTE_VARS', !!m);
const palette = m ? JSON.parse(m[1].replace(/'/g, '"')) : [];
ok('palette is non-empty', palette.length > 0);

const HAZARD = ['--warn', '--bad'];
for (const h of HAZARD) {
  ok('palette never names the hazard token ' + h, !palette.includes(h));
}

// Belt and suspenders: even an indirect alias (a token whose own value is the
// hazard hex, the way --good aliased --reality) must not slip through. Read
// each token's :root definition and compare resolved hex values.
function tokenHex(name) {
  const re = new RegExp('--' + name.replace(/^--/, '') + ':\\s*(#[0-9A-Fa-f]{6})');
  const found = cssSrc.match(re);
  return found ? found[1].toUpperCase() : null;
}
const warnHex = tokenHex('warn');
const badHex = tokenHex('bad');
ok('--warn resolves to a hex color in style.css', !!warnHex);
ok('--bad resolves to a hex color in style.css', !!badHex);

for (const v of palette) {
  const hex = tokenHex(v);
  ok('palette token ' + v + ' does not resolve to --warn\'s hex', hex !== warnHex);
  ok('palette token ' + v + ' does not resolve to --bad\'s hex', hex !== badHex);
}

console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS — lane colors never wear hazard semantics.'));
process.exit(fails ? 1 : 0);
