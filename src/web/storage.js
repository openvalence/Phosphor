/**
 * storage.js -- the mini build's browser storage: localStorage and sessionStorage are Map-backed stand-ins, so the
 * page reads and writes nothing on the visitor's device and a reload starts it fresh (docs/BUILD.md, Web builds).
 *
 * Constraints:
 * - main.js imports this first: every module that reads storage at import time must see the stand-in.
 * - Nothing in the mini build may use IndexedDB, cookies, Cache Storage or a service worker:
 *   test/mini-storage.test.mjs fails if any of them holds anything after a run.
 * - Other builds: localStorage and sessionStorage are untouched.
 */
function memoryStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(String(k)); },
    clear: () => m.clear(),
  };
}

if (import.meta.env.MODE === 'mini') {
  for (const name of ['localStorage', 'sessionStorage']) {
    const s = memoryStorage();
    Object.defineProperty(window, name, { configurable: true, get: () => s });
  }
}
