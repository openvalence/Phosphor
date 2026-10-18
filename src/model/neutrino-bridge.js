/**
 * neutrino-bridge.js -- Neutrino, the built-in machine (Nucleus neutrino.wasm, pinned in neutrino/neutrino.pin),
 * across one message port. hostNeutrino runs the machine (neutrino.worker.js in the app; a node test calls it
 * directly); bridgeNeutrino is the page half: a WebSocket stand-in for createSession and the /uitoken provider.
 *
 * Constraints:
 * - The host contract is Nucleus sim/neutrino/README.md (The host contract): the host owns time, drains every
 *   client after each tick, and stores the state blob when a tick reports it dirty.
 * - The state blob goes to the page: a worker has no localStorage.
 * - One machine per host; stopping it is terminating the worker.
 * - Port messages, page to host: boot {wasm, state, opts}, open/close {id}, send {id, data}, http {rid, method, path},
 *   pair {}, dgram {ip, port, data, wsPort}, pause {}, resume {}. Host to page: up {version, etag}, down {error},
 *   open/closed {id[, code]}, msg {id, data}, log {line}, state {blob}, http {rid, code, body}, dgram {ip, port, data}
 *   (a reply to send).
 * - Paused, nothing ticks and no time passes for the machine (its clock leaves the pause out): resume continues
 *   from the same instant. What arrives meanwhile waits for the next tick.
 * - Any socket id works: open/close/send/msg for an id the page half did not open go to `on` (Open to LAN's
 *   remotes, shell/lan.svelte.js), the same hub sessions as the page's own.
 */

// "[I] neutrino-sim: Nucleus 0.1.32-p4hub, catalog 44 entries, 25309 B, etag 1156bca7f02f424a"
const BANNER = /: \S+ (\S+), catalog .*, etag ([0-9a-f]+)/;

export function hostNeutrino(port, createNeutrino) {
  let M = null, cell = 0;
  // The machine's clock: performance.now() less the time spent paused, so a pause is no time to the machine.
  let timer = 0, held = 0, pausedAt = 0;
  const open = new Set();
  const post = (m, t) => port.postMessage(m, t || []);
  const u32 = (p) => M.HEAPU32[p >> 2];
  const out = () => M.HEAPU8.slice(u32(cell), u32(cell) + u32(cell + 4));
  const str = (s, fn) => { const p = M.stringToNewUTF8(s); try { return fn(p); } finally { M._free(p); } };

  function pump() {
    if (M._neutrino_tick(BigInt(Math.floor((performance.now() - held) * 1000))) & 1) {
      M._neutrino_state_get(cell, cell + 4);
      post({ op: 'state', blob: out() });
    }
    for (const id of open) {
      for (;;) {
        const r = M._neutrino_poll(id, cell, cell + 4);
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
    M = await createNeutrino({
      print: log, printErr: log,
      instantiateWasm: (imports, done) => { WebAssembly.instantiate(wasm, imports).then((r) => done(r.instance)); return {}; },
    });
    cell = M._malloc(8);
    const s = state && state.length ? M._malloc(state.length) : 0;
    if (s) M.HEAPU8.set(state, s);
    const okd = str(JSON.stringify(opts || {}), (o) => M._neutrino_create(o, s, s ? state.length : 0));
    if (s) M._free(s);
    if (okd !== 1) throw new Error('neutrino_create refused');
    post({ op: 'up', version: banner ? banner[1] : '', etag: banner ? banner[2] : '' });
    timer = setInterval(pump, 1);
  }

  port.onmessage = ({ data: m }) => {
    if (m.op === 'boot') { boot(m).catch((e) => post({ op: 'down', error: String((e && e.message) || e) })); return; }
    if (!M) return;
    if (m.op === 'pause') {
      if (timer) { clearInterval(timer); timer = 0; pausedAt = performance.now(); }
      return;
    }
    if (m.op === 'resume') {
      if (!timer) { held += performance.now() - pausedAt; timer = setInterval(pump, 1); }
      return;
    }
    if (m.op === 'open') {
      if (M._neutrino_connect(m.id) === 1) { open.add(m.id); post({ op: 'open', id: m.id }); }
      else post({ op: 'closed', id: m.id, code: 1013 });
    } else if (m.op === 'close') {
      if (open.delete(m.id)) M._neutrino_disconnect(m.id);
    } else if (m.op === 'send') {
      const p = M._malloc(Math.max(1, m.data.length));
      M.HEAPU8.set(m.data, p);
      M._neutrino_send(m.id, p, m.data.length);
      M._free(p);
    } else if (m.op === 'http') {
      const code = str(m.method, (me) => str(m.path, (pa) => M._neutrino_http(me, pa, 0, 0, cell, cell + 4)));
      post({ op: 'http', rid: m.rid, code, body: new TextDecoder().decode(out()) });
    } else if (m.op === 'pair') {
      M._neutrino_pair_press();
    } else if (m.op === 'dgram') {
      const p = M._malloc(Math.max(1, m.data.length));
      M.HEAPU8.set(m.data, p);
      const n = M._neutrino_datagram(p, m.data.length, m.ip, m.wsPort, cell);
      M._free(p);
      if (n > 0) post({ op: 'dgram', ip: m.ip, port: m.port, data: M.HEAPU8.slice(u32(cell), u32(cell) + n) });
    }
  };
}

/**
 * The page half. `on` receives the host's up, down, log, state and dgram messages, and every socket message for
 * an id this half did not open.
 * @returns {{WebSocket: Function, token: () => Promise<Uint8Array|null>, boot: Function, post: Function}}
 */
export function bridgeNeutrino(port, on) {
  const sockets = new Map(), calls = new Map();
  let nextId = 1, nextRid = 1;

  class NeutrinoSocket {
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
    if (!s && m.id !== undefined) on(m);
    else if (m.op === 'open') { if (s) { s.readyState = 1; if (s.onopen) s.onopen({}); } }
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
    WebSocket: NeutrinoSocket,
    /** A session's token provider: a fresh /uitoken per connect, else null (watch). */
    token: async () => {
      const r = await http('GET', '/uitoken');
      if (r.code !== 200) return null;
      const hex = JSON.parse(r.body).token;
      return Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));
    },
    boot: (wasm, state, opts) => port.postMessage({ op: 'boot', wasm, state, opts }, [wasm.buffer]),
    post: (m, transfer) => port.postMessage(m, transfer || []),
  };
}
