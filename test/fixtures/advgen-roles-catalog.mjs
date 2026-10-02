/**
 * advgen-roles-catalog.mjs -- the recorded valencesim catalog with the
 * annotations Nucleus emits (val-091.38..42) re-applied: RFC-081 advgen.* on the
 * advanced-pattern base controls, RFC-066 mod.* plus entry key 20 mod_target
 * on each modifier channel (mod.amount 0 = no modulation), RFC-067
 * action.store on the preset op and RFC-070 store_id on the writer and the
 * roster. Built in memory from valencesim-catalog.bin; nothing generated is
 * committed. Test-only.
 *
 * Constraints:
 * - Channels are found by their recorded names, never by id: this is the one
 *   place a test may know the reference machine (plugins/ and test/ are not
 *   scanned by check-device-knowledge.mjs).
 * - `drop` removes roles to exercise law 7 declines; `noStoreId` leaves the
 *   store unlinked.
 */
import { readFileSync } from 'node:fs';
import { cbDecodeFull, cbMap, cbArray, cbUint, cbInt, cbF32, cbBool, cbTstr, cbBstr, cbNull } from '../../../Valence/clients/js/cbor.js';
import { catalogEtag, toHex } from '../../../Valence/clients/js/sha256.js';
import { LIMITS } from '../../../Valence/clients/js/frames.js';

const BASE = { ap_mode: 'advgen.mode', master: 'advgen.master', max_depth: 'advgen.depth_max',
  min_depth: 'advgen.depth_min', in_speed: 'advgen.speed_in', out_speed: 'advgen.speed_out',
  in_accel: 'advgen.accel_in', out_accel: 'advgen.accel_out' };
const MOD = { amount: 'mod.amount', amplitude: 'mod.amount', in_step: 'mod.rise', in_wait: 'mod.hold', out_step: 'mod.fall',
  out_wait: 'mod.rest', offset: 'mod.phase' };
// Modifier channel name suffix -> the base field it rides.
const RIDES = { speedin: 'in_speed', speedout: 'out_speed', accelin: 'in_accel', accelout: 'out_accel',
  depth1: 'max_depth', depth2: 'min_depth' };

// Entry, layout-field and schema-field keys (SPEC §8.1).
const E = { id: 1, name: 2, layout: 8, schema: 9, storeId: 17, modTarget: 20, store: 12 };
const F = { name: 1, default: 9, desc: 12, role: 13 };

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
export function advgenCatalog({ drop = [], noStoreId = false } = {}) {
  const raw = readFileSync(new URL('./valencesim-catalog.bin', import.meta.url));
  const entries = cbDecodeFull(new Uint8Array(raw));
  const byName = (n) => entries.find((e) => e.get(E.name) === n);
  const role = (f, r) => { if (drop.includes(r)) f.delete(F.role); else f.set(F.role, r); };

  const adv = byName('pattern-advanced');
  for (const f of adv.get(E.layout)) if (BASE[f.get(F.name)]) role(f, BASE[f.get(F.name)]);
  const advNames = adv.get(E.layout).map((f) => f.get(F.name));

  for (const e of entries) {
    const m = /^pattern-adv-mod-(\w+)$/.exec(e.get(E.name));
    if (!m) continue;
    e.set(E.modTarget, [adv.get(E.id), advNames.indexOf(RIDES[m[1]])]);
    for (const f of e.get(E.layout)) {
      const r = MOD[f.get(F.name)];
      if (!r) continue;
      role(f, r);
      if (r === 'mod.amount') { f.set(F.default, 0); f.set(F.desc, 'How far the modulation swings; 0 = off.'); }
    }
  }

  const cmd = byName('pattern-presets-cmd');
  for (const f of cmd.get(E.schema).values()) if (['action.preset', 'action.store'].includes(f.get(F.role))) role(f, 'action.store');
  const roster = byName('pattern-presets-roster');
  if (noStoreId) {
    cmd.delete(E.storeId);
    roster.delete(E.storeId);
  } else {
    const sid = byName('pattern-presets').get(E.store).get(1);
    cmd.set(E.storeId, sid);
    roster.set(E.storeId, sid);
  }
  const bytes = enc(entries);
  return { bytes, etag: toHex(catalogEtag(bytes, LIMITS.etag_bytes)) };
}
