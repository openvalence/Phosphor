/**
 * advgen-roles-catalog.mjs -- the recorded valencesim catalog, which carries
 * the RFC-081 advgen.*, RFC-066 mod.* + mod_target, RFC-067 action.store and
 * RFC-070 store_id annotations since 5fc7a2d, with roles taken away on demand
 * so law 7 declines can be exercised. Built in memory; nothing generated is
 * committed. Test-only.
 *
 * Constraints:
 * - `drop` removes those roles wherever they appear; `noStoreId` removes
 *   every entry's store_id; `oscDrive` adds the c2h samples STREAM 0x2140
 *   osc-drive with channel role osc.drive (SPEC 9.7, Nucleus val-o9r), until a
 *   recording carries it. With none, the recording's own bytes return.
 */
import { readFileSync } from 'node:fs';
import { cbDecodeFull, cbMap, cbArray, cbUint, cbInt, cbF32, cbBool, cbTstr, cbBstr, cbNull } from '../../../Valence/clients/js/cbor.js';
import { catalogEtag, toHex } from '../../../Valence/clients/js/sha256.js';
import { LIMITS } from '../../../Valence/clients/js/frames.js';

// Entry and field keys (SPEC §8.1).
const E = { layout: 8, schema: 9, storeId: 17 };
const F_ROLE = 13;

function enc(v) {
  if (v instanceof Map) return cbMap([...v.entries()].sort((a, b) => a[0] - b[0]).map(([k, x]) => [k, enc(x)]));
  if (Array.isArray(v)) return cbArray(v.map(enc));
  if (v instanceof Uint8Array) return cbBstr(v);
  if (typeof v === 'string') return cbTstr(v);
  if (typeof v === 'boolean') return cbBool(v);
  if (v === null) return cbNull();
  if (!Number.isInteger(v)) return cbF32(v);
  return v < 0 ? cbInt(v) : cbUint(v);
}

/** @returns {{bytes: Uint8Array, etag: string}} */
export function advgenCatalog({ drop = [], noStoreId = false, oscDrive = false } = {}) {
  let bytes = new Uint8Array(readFileSync(new URL('./valencesim-catalog.bin', import.meta.url)));
  if (drop.length || noStoreId || oscDrive) {
    const entries = cbDecodeFull(bytes);
    const f32 = (name) => new Map([[1, name], [2, 6], [4, 1], [18, 4]]);
    if (oscDrive) entries.push(new Map([[1, 0x2140], [2, 'osc-drive'], [3, 1], [4, 1], [5, 1], [6, 50], [7, 2],
      [8, [f32('amplitude'), f32('frequency')]], [15, 0], [18, 'osc.drive']]));
    for (const e of entries) {
      for (const f of [...(e.get(E.layout) || []), ...(e.get(E.schema) || new Map()).values()]) {
        if (drop.includes(f.get(F_ROLE))) f.delete(F_ROLE);
      }
      if (noStoreId) e.delete(E.storeId);
    }
    bytes = enc(entries);
  }
  return { bytes, etag: toHex(catalogEtag(bytes, LIMITS.etag_bytes)) };
}
