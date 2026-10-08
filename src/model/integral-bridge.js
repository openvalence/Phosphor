/**
 * integral-bridge.js -- Neutrino, the built-in machine (Nucleus integral.wasm, pinned in integral/integral.pin),
 * across one message port. hostIntegral runs the machine (integral.worker.js in the app; a node test calls it
 * directly); bridgeIntegral is the page half: a WebSocket stand-in for createSession and the /uitoken provider.
 *
 * Constraints:
 * - The host contract is Nucleus sim/valencesim/README.md (The host contract): the host owns time, drains every
 *   client after each tick, and stores the state blob when a tick reports it dirty.
 * - The state blob goes to the page: a worker has no localStorage.
 * - One machine per host; stopping it is terminating the worker.
 * - Port messages, page to host: boot {wasm, state, opts}, open/close {id}, send {id, data}, http {rid, method, path}.
 *   Host to page: up {version, etag}, down {error}, open/closed {id[, code]}, msg {id, data}, log {line},
 *   state {blob}, http {rid, code, body}.
 */

// "[I] valencesim: Nucleus 0.1.32-p4hub, catalog 44 entries, 25309 B, etag 1156bca7f02f424a"
const BANNER = /: \S+ (\S+), catalog .*, etag ([0-9a-f]+)/;

export function hostIntegral(port, createIntegral) {
  let M = null, cell = 0;
  const open = new Set();
  const post = (m, t) => port.postMessage(m, t || []);
  const u32 = (p) => M.HEAPU32[p >> 2];
  const out = () => M.HEAPU8.slice(u32(cell), u32(cell) + u32(cell + 4));
  const str = (s, fn) => { const p = M.stringToNewUTF8(s); try { return fn(p); } finally { M._free(p); } };

  function pump() {
    if (M._integral_tick(BigInt(Math.floor(performance.now() * 1000))) & 1) {
      M._integral_state_get(cell, cell + 4);
      post({ op: 'state', blob: out() });
    }
    for (const id of open) {
      for (;;) {
        const r = M._integral_poll(id, cell, cell + 4);
        if (r === 0) break;
        if (r < 0) { open.delete(id); post({ op: 'closed', id, code: 1006 }); break; }
        const data = out();
        post({ op: 'msg', id, data }, [data.buffer]);
      }
    }
  }

  async function boot({ wasm, state, opts }) {
    let banner = null;
    const log = (line) => { banner = banner || BANNER.exec(line); post({ op: 'log', line }); };
    M = await createIntegral({
      print: log, printErr: log,
      instantiateWasm: (imports, done) => { WebAssembly.instantiate(wasm, imports).then((r) => done(r.instance)); return {}; },
    });
    cell = M._malloc(8);
    const s = state && state.length ? M._malloc(state.length) : 0;
    if (s) M.HEAPU8.set(state, s);
    const okd = str(JSON.stringify(opts || {}), (o) => M._integral_create(o, s, s ? state.length : 0));
    if (s) M._free(s);
    if (okd !== 1) throw new Error('integral_create refused');
    post({ op: 'up', version: banner ? banner[1] : '', etag: banner ? banner[2] : '' });
    setInterval(pump, 1);
  }

  port.onmessage = ({ data: m }) => {
    if (m.op === 'boot') { boot(m).catch((e) => post({ op: 'down', error: String((e && e.message) || e) })); return; }
    if (!M) return;
    if (m.op === 'open') {
      if (M._integral_connect(m.id) === 1) { open.add(m.id); post({ op: 'open', id: m.id }); }
      else post({ op: 'closed', id: m.id, code: 1013 });
    } else if (m.op === 'close') {
      if (open.delete(m.id)) M._integral_disconnect(m.id);
    } else if (m.op === 'send') {
      const p = M._malloc(Math.max(1, m.data.length));
      M.HEAPU8.set(m.data, p);
      M._integral_send(m.id, p, m.data.length);
      M._free(p);
    } else if (m.op === 'http') {
      const code = str(m.method, (me) => str(m.path, (pa) => M._integral_http(me, pa, 0, 0, cell, cell + 4)));
      post({ op: 'http', rid: m.rid, code, body: new TextDecoder().decode(out()) });
    }
  };
}

/**
 * The page half. `on` receives the host's up, down, log and state messages.
 * @returns {{WebSocket: Function, token: () => Promise<Uint8Array|null>, boot: Function}}
 */
export function bridgeIntegral(port, on) {
  const sockets = new Map(), calls = new Map();
  let nextId = 1, nextRid = 1;

  class IntegralSocket {
    constructor(url) {
      this.url = url;
      this.protocol = 'valence.v1';
      this.binaryType = 'arraybuffer';
      this.readyState = 0;
      this.bufferedAmount = 0;
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      this.id = nextId++;
      sockets.set(this.id, this);
      port.postMessage({ op: 'open', id: this.id });
    }
    send(data) {
      if (this.readyState !== 1) return;
      const b = data instanceof Uint8Array ? data.slice() : new Uint8Array(ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
      port.postMessage({ op: 'send', id: this.id, data: b }, [b.buffer]);
    }
    close() {
      if (this.readyState >= 2) return;
      port.postMessage({ op: 'close', id: this.id });
      this._closed(1000);
    }
    _closed(code) {
      this.readyState = 3;
      sockets.delete(this.id);
      queueMicrotask(() => { if (this.onclose) this.onclose({ code, reason: '', wasClean: code === 1000 }); });
    }
  }

  port.onmessage = ({ data: m }) => {
    const s = sockets.get(m.id);
    if (m.op === 'open') { if (s) { s.readyState = 1; if (s.onopen) s.onopen({}); } }
    else if (m.op === 'msg') { if (s && s.onmessage) s.onmessage({ data: m.data.buffer }); }
    else if (m.op === 'closed') { if (s) s._closed(m.code); }
    else if (m.op === 'http') { const done = calls.get(m.rid); calls.delete(m.rid); if (done) done(m); }
    else on(m);
  };

  const http = (method, path) => new Promise((done) => {
    const rid = nextRid++;
    calls.set(rid, done);
    port.postMessage({ op: 'http', rid, method, path });
  });

  return {
    WebSocket: IntegralSocket,
    /** A session's token provider: a fresh /uitoken per connect, else null (watch). */
    token: async () => {
      const r = await http('GET', '/uitoken');
      if (r.code !== 200) return null;
      const hex = JSON.parse(r.body).token;
      return Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));
    },
    boot: (wasm, state, opts) => port.postMessage({ op: 'boot', wasm, state, opts }, [wasm.buffer]),
  };
}
