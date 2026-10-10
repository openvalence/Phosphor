// Test-only entry for test/channel-heat.test.mjs: ChannelHeat on the recorded catalog, in a bar of the top
// bar's row height, fed synthetic frames. Never shipped; the app bundle never imports it.
import { mount } from 'svelte';
import '../../src/style.css';
import '../../src/ui/still.svelte.js';
import { machine } from '../../src/model/machine.svelte.js';
import { applyTheme } from '../../src/model/theme.js';
import { countFrames } from '../../src/model/activity.js';
import { decodeCatalog, encodeFrame, FRAME } from '../../../Valence/clients/js/index.js';
import ChannelHeat from '../../src/ui/ChannelHeat.svelte';

const bar = document.getElementById('bar');
bar.style.cssText = 'display:flex;align-items:center;gap:var(--sp-3);height:32px;padding:0 var(--gap);'
  + 'background:var(--bg-raised);box-shadow:inset 0 -1px 0 var(--line);color:var(--ink-hi)';
window.__opened = [];

/** One socket message of an 8-byte-payload frame per id. */
function feed(dir, ids, type = FRAME.STATE) {
  const parts = ids.map((id) => encodeFrame(type, id, new Uint8Array(8)));
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  countFrames(dir, out);
}
window.__feed = feed;
/** Feed `ids` as one bundle at `hz` for `ms`; resolves when done. */
window.__run = (dir, ids, hz, ms) => new Promise((done) => {
  const t0 = Date.now();
  const id = setInterval(() => { feed(dir, ids); if (Date.now() - t0 >= ms) { clearInterval(id); done(); } }, 1000 / hz);
});
window.__nack = (channel, name) => machine.events.nacks.push({ channel, code: 0, name, at: Date.now() });
window.__theme = (id) => applyTheme(id, { persist: false });
window.__entries = () => machine.catalog.entries.map((e) => ({ id: e.id, name: e.name, cls: e.clsName }));

fetch('/catalog.bin').then((r) => r.arrayBuffer()).then((b) => {
  machine.catalog.entries = decodeCatalog(new Uint8Array(b));
  machine.catalog.ready = true;
  mount(ChannelHeat, { target: document.getElementById('heat'), props: { onopen: (k) => window.__opened.push(k) } });
  window.__ready = true;
});
