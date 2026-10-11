/**
 * neutrino.mjs -- one Neutrino (Nucleus integral.wasm, the vendored src/model/integral) per call, booted from a
 * compiled WebAssembly.Module, and the in-memory socket a valence-js session runs over.
 *
 * Constraints:
 * - The host contract is Nucleus sim/valencesim/README.md (The host contract); wasm/check.mjs there is the
 *   reference. The host owns time: tick(nowUs) is the only clock, and drain() delivers after each tick.
 * - One machine per instance; a restart is a new instance. Each instance has its own memory (the module
 *   exports it), so the hub's process-wide singletons never meet.
 * - A trap (WebAssembly.RuntimeError) kills the instance: `trap` holds it and every later call is a no-op.
 * - Sockets deliver synchronously: send() lands in the hub's 32-frame ring (a full ring drops, counted in
 *   ringDrops), onmessage fires inside drain().
 */
import createIntegral from '../../src/model/integral/integral.js';
import { WASM } from '../../src/model/integral/bytes.js';

export const wasmBytes = () => new Uint8Array(Buffer.from(WASM, 'base64'));
const BANNER = /: \S+ (\S+), catalog .*, etag ([0-9a-f]+)/;

export async function bootNeutrino(module, opts = {}, onLog = () => {}) {
  let banner = null;
  const log = (l) => { banner = banner || BANNER.exec(l); onLog(l); };
  const M = await createIntegral({
    print: log, printErr: log,
    instantiateWasm: (imports, done) => { WebAssembly.instantiate(module, imports).then((i) => done(i, module)); return {}; },
  });
  const cell = M._malloc(8);
  const u32 = (p) => M.HEAPU32[p >> 2];
  const out = () => M.HEAPU8.slice(u32(cell), u32(cell) + u32(cell + 4));
  const str = (s, fn) => { const p = M.stringToNewUTF8(s); try { return fn(p); } finally { M._free(p); } };
  if (str(JSON.stringify(opts), (o) => M._integral_create(o, 0, 0)) !== 1) throw new Error('integral_create refused');

  const sockets = new Map();
  let nextId = 1;
  const hub = { trap: null, ringDrops: 0, version: banner ? banner[1] : '', etag: banner ? banner[2] : '', sockets };
  const guard = (fn) => { if (hub.trap) return 0; try { return fn(); } catch (e) { hub.trap = e; for (const s of [...sockets.values()]) s._closed(1011); return 0; } };

  class NeutrinoSocket {
    constructor(url) {
      this.url = url;
      this.protocol = 'valence.v1';
      this.binaryType = 'arraybuffer';
      this.readyState = 0;
      this.bufferedAmount = 0;
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      this.id = nextId++;
      queueMicrotask(() => {
        if (this.readyState !== 0) return;
        if (guard(() => M._integral_connect(this.id)) !== 1) { this._closed(1013); return; }
        sockets.set(this.id, this);
        this.readyState = 1;
        if (this.onopen) this.onopen({});
      });
    }
    send(data) {
      if (this.readyState !== 1) return;
      const b = data instanceof Uint8Array ? data : new Uint8Array(ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
      guard(() => {
        const p = M._malloc(Math.max(1, b.length));
        M.HEAPU8.set(b, p);
        if (M._integral_send(this.id, p, b.length) !== 1) hub.ringDrops++;
        M._free(p);
      });
    }
    close() {
      if (this.readyState >= 2) return;
      if (this.readyState === 1) guard(() => M._integral_disconnect(this.id));
      this._closed(1000);
    }
    _closed(code) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      sockets.delete(this.id);
      queueMicrotask(() => { if (this.onclose) this.onclose({ code, reason: '', wasClean: code === 1000 }); });
    }
  }

  return Object.assign(hub, {
    WebSocket: NeutrinoSocket,
    /** Every 1 ms pass up to nowUs (BigInt-safe number); bit0 = the state blob changed. */
    tick: (nowUs) => guard(() => M._integral_tick(BigInt(Math.floor(nowUs)))),
    drain() {
      for (const s of [...sockets.values()]) {
        for (;;) {
          const r = guard(() => M._integral_poll(s.id, cell, cell + 4));
          if (r === 0) break;
          if (r < 0) { s._closed(1006); break; }
          if (s.onmessage) s.onmessage({ data: out().buffer });
        }
      }
    },
    /** A session's token provider: a fresh /uitoken per connect, retried past the 250 ms mint gate (429). */
    token: async () => {
      for (let i = 0; i < 6; i++) {
        const r = guard(() => str('GET', (me) => str('/uitoken', (pa) => M._integral_http(me, pa, 0, 0, cell, cell + 4))));
        if (r === 200) return Uint8Array.from(JSON.parse(new TextDecoder().decode(out())).token.match(/../g), (h) => parseInt(h, 16));
        if (r !== 429) return null;
        await new Promise((res) => setTimeout(res, 300));
      }
      return null;
    },
    memBytes: () => M.HEAPU8.buffer.byteLength,
  });
}
