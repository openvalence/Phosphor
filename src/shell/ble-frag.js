/**
 * ble-frag.js — SPEC §5.6 fragmentation and reassembly for the BLE duck.
 *
 * Constraints:
 * - Pure: no Tauri, no timers; the caller passes the clock. Mirrors
 *   Valence/lib/valence/include/valence/wire/fragmentation.hpp, which wins on
 *   any disagreement.
 * - Control frames only. STATE and STREAM never fragment (§5.6); an oversized
 *   one is refused by fragmentFrame, not split. The 12-byte ESTOP frame is
 *   not header-shaped and always passes through untouched.
 * - The last fragment carries no flag: it is told from a whole frame only by
 *   an open (type, seq) reassembly.
 */

import {
  FRAME, HEADER_BYTES, LIMITS, FLAG_FRAG_START, FLAG_FRAG_MORE,
} from '../../../Valence/clients/js/frames.js';

const FRAG_INDEX_BYTES = 2;
const FRAG_MAX_PER_MESSAGE = 32; // C++ kMaxFragmentsPerMessage
const MAX_PAYLOAD = 512 - HEADER_BYTES; // C++ kFrameBufferCapacity - kHeaderBytes
const ESTOP_BYTES = 12;
const FRAG_FLAGS = FLAG_FRAG_START | FLAG_FRAG_MORE;

const isEstop = (b) => b.length === ESTOP_BYTES
  && b[0] === 0xe5 && b[1] === 0xe5 && b[2] === 0xe5 && b[3] === 0xe5;

function header(b) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { type: b[0], flags: b[1], channel: v.getUint16(2, true), seq: v.getUint16(4, true), len: v.getUint16(6, true) };
}

function build(type, flags, channel, seq, payloadLen, parts) {
  const out = new Uint8Array(HEADER_BYTES + payloadLen);
  const v = new DataView(out.buffer);
  out[0] = type;
  out[1] = flags;
  v.setUint16(2, channel, true);
  v.setUint16(4, seq, true);
  v.setUint16(6, payloadLen, true);
  let pos = HEADER_BYTES;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

/**
 * Split one frame into wire fragments that each fit maxFrame bytes. Returns
 * the untouched frame as the only element when it already fits; null when it
 * must not or cannot be split (STATE/STREAM, too short, no room).
 */
export function fragmentFrame(frame, maxFrame) {
  if (frame.length <= maxFrame || isEstop(frame)) return [frame];
  if (frame.length < HEADER_BYTES || maxFrame <= HEADER_BYTES + FRAG_INDEX_BYTES) return null;
  const h = header(frame);
  if (h.type === FRAME.STATE || h.type === FRAME.STREAM) return null;
  const budget = maxFrame - HEADER_BYTES - FRAG_INDEX_BYTES;
  const payload = frame.subarray(HEADER_BYTES);
  const n = Math.ceil(payload.length / budget);
  const out = [];
  for (let i = 0; i < n; i++) {
    const slice = payload.subarray(i * budget, (i + 1) * budget);
    const idx = new Uint8Array([i & 0xff, i >> 8]);
    const flags = (i === 0 ? FLAG_FRAG_START : 0) | (i + 1 < n ? FLAG_FRAG_MORE : 0);
    out.push(build(h.type, flags, h.channel, h.seq, FRAG_INDEX_BYTES + slice.length, [idx, slice]));
  }
  return out;
}

/** Receive side: at most frag_max_concurrent_per_session slots keyed (type, seq). */
export class Reassembler {
  constructor() {
    this.slots = [];
    this.stats = { completed: 0, timeouts: 0, evictions: 0 };
  }

  /**
   * One inbound notification. Returns { frame } to deliver (whole frames pass
   * through byte-identical), { error } when a transfer was refused, or null
   * when the fragment was absorbed and the message is not complete.
   */
  accept(bytes, now) {
    if (bytes.length < HEADER_BYTES || isEstop(bytes)) return { frame: bytes };
    const live = this.slots.filter((s) => now - s.start < LIMITS.frag_reassembly_timeout_ms);
    this.stats.timeouts += this.slots.length - live.length;
    this.slots = live;

    const h = header(bytes);
    const f = h.flags & FRAG_FLAGS;
    let slot = this.slots.find((s) => s.type === h.type && s.seq === h.seq);
    if (!f && !slot) return { frame: bytes };

    const payload = bytes.subarray(HEADER_BYTES, HEADER_BYTES + h.len);
    if (h.len > bytes.length - HEADER_BYTES || payload.length < FRAG_INDEX_BYTES) return null;
    const index = payload[0] | (payload[1] << 8);
    if (index >= FRAG_MAX_PER_MESSAGE) return { error: 'ble-frag: fragment index out of range' };
    const slice = payload.subarray(FRAG_INDEX_BYTES);

    if (!slot) {
      if (this.slots.length >= LIMITS.frag_max_concurrent_per_session) {
        this.slots.shift(); // oldest: slots are appended in start order
        this.stats.evictions++;
      }
      slot = { type: h.type, seq: h.seq, channel: h.channel, start: now, parts: new Map(), total: 0, bytes: 0 };
      this.slots.push(slot);
    }
    slot.channel = h.channel;

    let at = index;
    if (f === FLAG_FRAG_START) { slot.total = 1; at = 0; }
    else if (!(f & FLAG_FRAG_MORE)) slot.total = index + 1;
    if (!slot.parts.has(at)) {
      slot.bytes += slice.length;
      if (slot.bytes > MAX_PAYLOAD) {
        this.slots = this.slots.filter((s) => s !== slot);
        return { error: 'ble-frag: reassembled frame over capacity' };
      }
      slot.parts.set(at, slice);
    }

    if (!slot.total) return null;
    const ordered = [];
    for (let i = 0; i < slot.total; i++) {
      if (!slot.parts.has(i)) return null;
      ordered.push(slot.parts.get(i));
    }
    this.slots = this.slots.filter((s) => s !== slot);
    this.stats.completed++;
    return { frame: build(slot.type, 0, slot.channel, slot.seq, slot.bytes, ordered) };
  }
}
