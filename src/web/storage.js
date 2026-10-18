/**
 * storage.js -- the demo build's localStorage: every key under DEMO_PREFIX, so the demo and the web build
 * beside it on one origin never share state, and Reset (web.js) clears the demo's keys alone.
 *
 * Constraints:
 * - main.js imports this first: every module that reads localStorage at import time must see the stand-in.
 * - Other builds: demoStorage is null and localStorage is untouched.
 */
const DEMO_PREFIX = 'demo:';

function prefixed(real) {
  const own = () => {
    const ks = [];
    for (let i = 0; i < real.length; i++) { const k = real.key(i); if (k.startsWith(DEMO_PREFIX)) ks.push(k); }
    return ks;
  };
  return {
    get length() { return own().length; },
    key: (i) => own()[i]?.slice(DEMO_PREFIX.length) ?? null,
    getItem: (k) => real.getItem(DEMO_PREFIX + k),
    setItem: (k, v) => real.setItem(DEMO_PREFIX + k, v),
    removeItem: (k) => real.removeItem(DEMO_PREFIX + k),
    clear: () => { for (const k of own()) real.removeItem(k); },
  };
}

export let demoStorage = null;
if (import.meta.env.MODE === 'demo') {
  try {
    demoStorage = prefixed(window.localStorage);
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => demoStorage });
  } catch { /* storage blocked: every reader already falls back to memory */ }
}
