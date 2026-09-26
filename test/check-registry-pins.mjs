/**
 * check-registry-pins.mjs — T20 staleness gate for hand-copied registry
 * numbers that Valence's codegen does not emit as importable constants.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A YAML PARSER: most registry vocabulary
 * (frame ids, NACK codes, CBOR keys, `ws_subprotocol`...) is already emitted
 * to `Valence/clients/js/generated/registry_vocab.js` and JS just imports it
 * — no pin needed, and this script does not re-check those. A SMALL handful
 * of values are declared in registry.yaml but never emitted by
 * `Valence/tools/gen_registry_header.py` (checked directly: it has no
 * `udp_discovery`/`ble_identity` output), so `src-tauri/src/discovery.rs`
 * and `src/shell/ble-ws.js` carry them as literals with a comment pointing
 * here (TRAPS T20). This script is their staleness gate: it reads the
 * scalars straight out of registry.yaml with a few line-anchored regexes
 * (the values are simple scalars; a YAML dependency buys nothing) and greps
 * the hand-copies for a match.
 *
 * RUST HAS NO IMPORT ESCAPE. discovery.rs cannot pull a JS module, so for
 * every Rust pin this script IS the gate, full stop — there is no "convert
 * to import" option on that side, ever.
 *
 * Run: node test/check-registry-pins.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..');
const REGISTRY = join(ROOT, '..', 'Valence', 'spec', 'registry', 'registry.yaml');

const registryText = (() => {
  try {
    return readFileSync(REGISTRY, 'utf8');
  } catch (e) {
    console.error('check-registry-pins: cannot read sibling registry at ' + REGISTRY);
    console.error('  ' + e.message);
    process.exit(1);
  }
})();

/** Pull `key: value` out of one indented block (e.g. everything under `udp_discovery:`). */
function section(name) {
  const m = registryText.match(new RegExp('^' + name + ':\\n((?:[ \\t]+.*\\n?)*)', 'm'));
  if (!m) throw new Error('registry.yaml: section "' + name + '" not found');
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s+(\w+):\s*"?([^"#\n]*?)"?\s*(#.*)?$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

const udp = section('udp_discovery');
const ble = section('ble_identity');

const registryValues = {
  udp_port: udp.port,
  udp_magic: udp.magic, // ASCII, e.g. "VLNC"
  ble_service_uuid: ble.service_uuid.toLowerCase(),
  ble_write_char_uuid: ble.write_char_uuid.toLowerCase(),
  ble_notify_char_uuid: ble.notify_char_uuid.toLowerCase(),
};

for (const [k, v] of Object.entries(registryValues)) {
  if (!v) throw new Error('registry.yaml: expected a value for ' + k + ', got nothing (registry format changed?)');
}

const magicBytes = [...registryValues.udp_magic].map((c) => c.charCodeAt(0));
const magicHex = magicBytes.map((b) => '0x' + b.toString(16).toUpperCase().padStart(2, '0'));

/** Find the 1-based line number of the first match of `re` in `text`. */
function lineOf(text, re) {
  const m = re.exec(text);
  if (!m) return null;
  return text.slice(0, m.index).split('\n').length;
}

const failures = [];

function checkPin(file, re, extract, expected, label) {
  const path = join(ROOT, file);
  const text = readFileSync(path, 'utf8');
  const m = re.exec(text);
  if (!m) {
    failures.push({ file, label, reason: 'pattern not found — pin moved or renamed?' });
    return;
  }
  const actual = extract(m);
  if (actual !== expected) {
    failures.push({
      file,
      line: lineOf(text, re),
      label,
      reason: 'value drifted from registry',
      actual,
      expected,
    });
  }
}

// src-tauri/src/discovery.rs -- Rust, no import escape, gated here permanently.
checkPin(
  'src-tauri/src/discovery.rs',
  /const PORT: u16 = (\d+);/,
  (m) => m[1],
  registryValues.udp_port,
  'discovery.rs PORT vs registry udp_discovery.port',
);
checkPin(
  'src-tauri/src/discovery.rs',
  /const MAGIC: \[u8; 4\] = \[(0x[0-9A-Fa-f]{2}), (0x[0-9A-Fa-f]{2}), (0x[0-9A-Fa-f]{2}), (0x[0-9A-Fa-f]{2})\];/,
  (m) => [m[1], m[2], m[3], m[4]].join(', ').toLowerCase(),
  magicHex.join(', ').toLowerCase(),
  'discovery.rs MAGIC vs registry udp_discovery.magic ("' + registryValues.udp_magic + '")',
);

// src/shell/ble-ws.js -- BLE UUIDs. Not codegen output (see file banner); gated here.
checkPin(
  'src/shell/ble-ws.js',
  /BLE_SERVICE = '([0-9a-f-]+)'/,
  (m) => m[1].toLowerCase(),
  registryValues.ble_service_uuid,
  'ble-ws.js BLE_SERVICE vs registry ble_identity.service_uuid',
);
checkPin(
  'src/shell/ble-ws.js',
  /CHAR_C2H_WRITE = '([0-9a-f-]+)'/,
  (m) => m[1].toLowerCase(),
  registryValues.ble_write_char_uuid,
  'ble-ws.js CHAR_C2H_WRITE vs registry ble_identity.write_char_uuid',
);
checkPin(
  'src/shell/ble-ws.js',
  /CHAR_H2C_NOTIFY = '([0-9a-f-]+)'/,
  (m) => m[1].toLowerCase(),
  registryValues.ble_notify_char_uuid,
  'ble-ws.js CHAR_H2C_NOTIFY vs registry ble_identity.notify_char_uuid',
);

// src/shell/ShellBar.svelte -- discovery port, used only for the empty-result
// message string (discovery.rs owns the real socket), but a stale number
// there lies to the operator about what port it actually probed.
checkPin(
  'src/shell/ShellBar.svelte',
  /DISCOVERY_PORT = (\d+);/,
  (m) => m[1],
  registryValues.udp_port,
  'ShellBar.svelte DISCOVERY_PORT vs registry udp_discovery.port',
);

console.log('registry-pins check');
console.log('  registry : ' + REGISTRY);
console.log('  pins     : 5 (2 Rust, 3 JS)');

if (!failures.length) {
  console.log('\nPASS — every hand-copied registry pin matches registry.yaml.');
  process.exit(0);
}

console.log('\nFAIL — ' + failures.length + ' pin(s) drifted from the registry (T20):\n');
for (const f of failures) {
  console.log('  ' + f.file + (f.line ? ':' + f.line : '') + '  [' + f.label + ']');
  console.log('      ' + f.reason);
  if ('actual' in f) {
    console.log('      file has     : ' + f.actual);
    console.log('      registry has : ' + f.expected);
  }
}
process.exit(1);
