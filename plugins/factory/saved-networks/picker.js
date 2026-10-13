/**
 * picker.js -- the phone-style network picker (RFC-118 draft): the networks the hub hears, strongest
 * first, a tap to join or save one, then Other network… and Advanced (the slot card, slots.js).
 *
 * Constraints:
 * - Built on the plugin API subset alone (ui, field, value, gate, write): the Network card passes the
 *   plugin's api, the setup flow the shell's (plugins.svelte.js shellApi), so both draw this one module.
 * - The act is the binding's: opts.join (a credential binding, the BLE setup flow) sends wifi_join and
 *   reports start and done to it; otherwise save, which stores and does not join (wifi_join is refused
 *   over WebSocket, and a join from a session riding the current network would strand it).
 * - The scan is asked only when RFC-118 is detected (wire.js scanSupported); without it, or below
 *   configure, the card is the slot card alone.
 * - The password field is write-only: read once at send, cleared at once, never kept, logged or shown.
 * - The hub decides: a row is saved or connected when its STATE says so; a refusal is the hub's reason in
 *   the one status line, which is reserved up front.
 */
import { DRAFT, SCAN_WAIT_MS, readList, readVisible, scanOf, scanSupported, scanRefusal, refusalWords, joinWords, bars } from './wire.js';
import { mountSlots } from './slots.js';

const COPY = {
  other: 'Other network…',
  advanced: 'Advanced',
  scan: 'Scan',
  scanning: 'Scanning',
  noScan: 'No scan result',
  none: 'No networks heard',
  name: 'Name',
  pass: 'Password',
  cancel: 'Cancel',
  join: 'Join',
  save: 'Save',
  joining: 'Joining',
  saving: 'Saving',
  joined: 'Joined',
  saved: 'Saved',
  savedTip: 'Joins at the next connect when strongest',
  connected: 'Connected',
};
const OP_ROLE = 'action.provision';
const SVG = 'http://www.w3.org/2000/svg';

const CSS = `
.wp { display: grid; gap: var(--sp-3); min-width: 0; }
.wp [hidden] { display: none !important; }
.wp-list { display: grid; margin: 0; padding: 0; list-style: none; min-width: 0; }
.wp-row { display: flex; align-items: center; gap: var(--sp-3); width: 100%; min-height: var(--tap); padding: 0 var(--sp-2);
  background: none; border: 0; border-bottom: 1px solid var(--line-1); color: var(--tx); font: inherit; text-align: left; cursor: pointer; }
.wp-row:disabled { cursor: default; }
.wp-row:not(:disabled):hover { background: var(--bg-hover, rgba(255,255,255,.04)); }
.wp-ssid { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-tag { font-size: .72rem; color: var(--ink-dim); }
.wp-row[aria-current='true'] .wp-ssid { color: var(--reality); }
.wp-ic { flex: 0 0 auto; width: 1rem; height: 1rem; fill: currentColor; stroke: currentColor; color: var(--ink-dim); }
.wp-ic .off { opacity: .25; }
.wp-row[aria-current='true'] .wp-ok { color: var(--reality); }
.wp-busy { color: var(--ink-dim); font-size: .78rem; }
.wp-join { display: grid; gap: var(--sp-3); }
.wp-join h4 { margin: 0; font-size: .9rem; color: var(--ink-hi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-acts { display: flex; flex-wrap: wrap; gap: var(--sp-2); justify-content: flex-end; }
.wp-acts .og-btn { min-height: var(--tap); min-width: 5.5rem; }
.wp-foot { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.wp-foot .og-btn { min-height: var(--tap); }
.wp-foot .wp-scan { margin-left: auto; }
.wp-status { margin: 0; min-height: 1.1rem; font-size: .78rem; line-height: 1.1rem; color: var(--ink-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-status[data-tone='warn'] { color: var(--warn-ink); }
.wp-status[data-tone='ok'] { color: var(--reality); }
`;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
function svg(cls, paths) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('class', 'wp-ic ' + cls);
  s.setAttribute('aria-hidden', 'true');
  for (const [d, off, line] of paths) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    if (off) p.setAttribute('class', 'off');
    if (line) { p.setAttribute('fill', 'none'); p.setAttribute('stroke-width', '1.5'); } else p.setAttribute('stroke', 'none');
    s.append(p);
  }
  return s;
}
const barsIcon = (n) => svg('wp-bars', ['M1 12h2.5v3H1z', 'M5 9h2.5v6H5z', 'M9 5.5h2.5V15H9z', 'M13 2h2.5v13H13z'].map((d, i) => [d, i >= n]));
const lockIcon = () => svg('wp-lock', [['M4 7h8v7H4z'], ['M5.5 7V5a2.5 2.5 0 015 0v2', false, true]]);
const checkIcon = () => svg('wp-ok', [['M3 8.5l3 3 7-7', false, true]]);

/** Does this hub list networks for this claim (RFC-118 detected)? The setup flow picks the picker by it. */
export const pickerReady = (api, f) => scanSupported(api.field(OP_ROLE), f);

/**
 * Mount the picker. opts.join(e): the host's credential binding; e is {phase: 'start'|'done', action, ...result}.
 * Returns {update, unmount}.
 */
export function mountPicker(api, host, f, opts = {}) {
  const ui = api.ui;
  const read = (field) => api.value(field);
  const opField = () => api.field(OP_ROLE);
  const joining = typeof opts.join === 'function';

  let mode = 'slots', list = null, rows = null, busy = false, waitAt = null, waitTimer = 0, target = null, sig = '', asked = false, dead = false;

  const items = el('ul', 'wp-list');
  items.setAttribute('aria-label', 'Networks');
  const empty = el('p', 'wp-busy', COPY.none);
  const pick = el('div', 'wp-pick');
  pick.append(items, empty);

  const head = el('h4');
  const ssid = ui.text({ placeholder: COPY.name, label: COPY.name });
  const pass = ui.text({ type: 'password', placeholder: COPY.pass, label: COPY.pass });
  const cancel = ui.button({ label: COPY.cancel, onClick: () => show(null) });
  const go = ui.button({ label: joining ? COPY.join : COPY.save, tone: 'primary', onClick: () => submit() });
  const acts = el('div', 'wp-acts');
  acts.append(cancel, go);
  const form = el('div', 'wp-join');
  form.append(head, ssid, pass, acts);

  const other = ui.button({ label: COPY.other, onClick: () => show({ ssid: '', secured: true, other: true }) });
  const adv = ui.button({ label: COPY.advanced, pressed: false, onClick: () => draw() });
  const rescan = ui.button({ label: COPY.scan, class: 'wp-scan', onClick: () => scan() });
  const foot = el('div', 'wp-foot');
  foot.append(other, adv, rescan);

  const status = el('p', 'wp-status');
  status.setAttribute('role', 'status');
  const slotBox = el('div', 'wp-adv');
  const root = el('div', 'wp');
  root.append(el('style', null, CSS), pick, form, foot, status, slotBox);
  host.append(root);
  const slots = mountSlots(api, slotBox, f);

  const say = (text, tone = 'warn', tip = '') => {
    status.textContent = text;
    if (text && tone) status.dataset.tone = tone; else delete status.dataset.tone;
    if (tip) status.dataset.tip = tip; else delete status.dataset.tip;
  };
  const gate = () => { const op = opField(); return op ? api.gate(op) : 'Not on this hub'; };

  // List when RFC-118 is detected and this session may provision; a dropped link keeps the last choice.
  function pickMode() {
    if (!scanSupported(opField(), f)) return 'slots';
    const g = gate();
    return !g ? 'list' : g === 'no hub link' ? mode : 'slots';
  }

  function show(t) {
    target = t;
    pass.value = '';
    ssid.value = '';
    if (t) say('');
    draw();
    (t && t.other ? ssid : pass).focus?.();
  }

  const stopWait = () => { clearTimeout(waitTimer); waitAt = null; };
  async function scan() {
    const op = opField();
    if (mode !== 'list' || busy || waitAt != null || gate()) return;
    const at = scanOf(f, read) ?? 0;
    waitAt = at;
    say(COPY.scanning, '');
    draw();
    const r = await api.write(op, DRAFT.op.scan, {});
    if (!r || !r.ok) { stopWait(); say(scanRefusal(r)); draw(); return; }
    // The ECHO carries no rows: they come on the visible-networks STATE with a new scan counter.
    if (waitAt === at && !dead) waitTimer = setTimeout(() => { stopWait(); if (status.textContent === COPY.scanning) say(COPY.noScan); draw(); }, SCAN_WAIT_MS);
  }

  async function act(name, secret) {
    const op = opField();
    if (!op || busy || gate()) return;
    busy = true;
    say(joining ? COPY.joining : COPY.saving, '');
    draw();
    let r;
    if (joining) {
      opts.join({ phase: 'start', action: op });
      r = await api.write(op, DRAFT.op.join, { [DRAFT.key.ssid]: name, [DRAFT.key.passphrase]: secret });
      opts.join({ phase: 'done', action: op, ...r });
    } else {
      // A CONFLICT (the list changed under the save) is the hub's words, not retried: the secret is gone by then.
      r = await api.write(op, DRAFT.op.save, { [DRAFT.key.generation]: list ? list.generation : 0, [DRAFT.key.ssid]: name, [DRAFT.key.passphrase]: secret });
    }
    busy = false;
    if (r && r.ok) {
      say(joining ? COPY.joined : COPY.saved, 'ok', joining ? '' : COPY.savedTip);
      target = null;
    } else if (!r || r.error !== 'canceled') say(joining ? joinWords(r) : refusalWords(r) || 'Not saved');
    draw();
  }

  function submit() {
    if (!target) return;
    // Read once and clear before the send: the field never holds a secret across the wire.
    const secret = pass.value;
    pass.value = '';
    const name = target.other ? ssid.value : target.ssid;
    if (name) act(name, secret);
  }
  for (const input of [ssid, pass]) {
    input.addEventListener('input', draw);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !go.disabled) submit(); });
  }

  function tap(row) {
    if (row.connected) return;
    if (!joining && row.saved) { say(COPY.saved, 'ok', COPY.savedTip); return; }
    if (row.secured) show(row); else act(row.ssid, '');
  }

  function rowEl(row) {
    const b = el('button', 'wp-row');
    b.type = 'button';
    const tag = row.connected ? COPY.connected : row.saved ? COPY.saved : '';
    b.append(barsIcon(bars(row.rssi)), el('span', 'wp-ssid', row.ssid), el('span', 'wp-tag', tag));
    if (row.secured) b.append(lockIcon());
    if (row.connected) { b.append(checkIcon()); b.setAttribute('aria-current', 'true'); }
    b.dataset.ssid = row.ssid;
    b.dataset.tip = row.rssi != null ? row.rssi + ' dBm' : '';
    b.addEventListener('click', () => tap(row));
    const li = el('li');
    li.append(b);
    return li;
  }

  function draw() {
    const g = gate();
    const listing = mode === 'list';
    const advOpen = !listing || !!adv.pressed;
    pick.hidden = !listing || !!target;
    form.hidden = !listing || !target;
    foot.hidden = !listing || !!target;
    rescan.hidden = joining;
    status.hidden = !listing;
    slotBox.hidden = !advOpen || (listing && !!target);
    if (!listing) return;
    rescan.disabled = !!g || busy || waitAt != null;
    other.disabled = !!g || busy;
    if (target) {
      head.textContent = target.other ? COPY.other : target.ssid;
      ssid.hidden = !target.other;
      pass.hidden = !target.secured;
      ssid.disabled = pass.disabled = cancel.disabled = busy;
      go.disabled = !!g || busy || (target.other ? !ssid.value : target.secured && !pass.value);
      go.tip = g;
    }
    // Rows are rebuilt only when what a tap acts on changes; a rescan's new signal is patched in place, so a
    // rebuild never lands between a press and its click.
    const next = JSON.stringify([(rows || []).map((r) => [r.ssid, r.secured, r.saved, !!r.connected]), !!g, busy]);
    if (next !== sig) {
      sig = next;
      items.replaceChildren(...(rows || []).map(rowEl));
      for (const b of items.querySelectorAll('.wp-row')) b.disabled = !!g || busy;
    }
    (rows || []).forEach((r, i) => {
      const b = items.children[i] && items.children[i].firstChild;
      if (!b) return;
      b.dataset.tip = r.rssi != null ? r.rssi + ' dBm' : '';
      b.querySelectorAll('.wp-bars path').forEach((p, k) => p.classList.toggle('off', k >= bars(r.rssi)));
    });
    empty.hidden = !!(rows && rows.length) || waitAt != null;
  }

  function update() {
    list = readList(f.nets, f.names, read, list);
    rows = f.vis ? readVisible(f, read, list) : null;
    const was = mode;
    mode = pickMode();
    if (mode !== 'list' && target) { target = null; pass.value = ''; }
    if (waitAt != null && (scanOf(f, read) ?? 0) !== waitAt) { stopWait(); if (status.textContent === COPY.scanning) say(''); }
    slots.update();
    draw();
    if (mode === 'list' && was !== 'list' && !asked) { asked = true; scan(); }
  }
  update();

  return {
    update,
    unmount() { dead = true; stopWait(); pass.value = ''; slots.unmount(); root.remove(); },
  };
}
