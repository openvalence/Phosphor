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
 * - Rows are keyed by SSID, never by index: the hub re-sorts by signal every scan, so the on-screen order is
 *   HELD while a pointer is down, focus is in the list or a sheet is open, and sorted again on release.
 * - Rows pushed at the grant are stale until the scan counter (compared for equality only) differs from its
 *   value at the grant: they show greyed and cannot be tapped.
 * - A saved row never joins on one tap: its sheet offers the passphrase again, move and remove.
 */
import { DRAFT, SCAN_WAIT_MS, MOTION_RETRY_MS, readList, readVisible, scanOf, scanSupported, scanRefusal, isInterlock, refusalWords, joinWords, slotOf, bars } from './wire.js';
import { mountSlots } from './slots.js';

const COPY = {
  other: 'Other network…',
  advanced: 'Advanced',
  scan: 'Scan',
  scanning: 'Scanning',
  noScan: 'Scan timed out',
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
  up: 'Move up',
  down: 'Move down',
  remove: 'Remove',
  sure: 'Confirm',
  removed: 'Removed',
  moved: 'Moved',
  changed: 'List changed, check and retry',
};
const ARM_MS = 4000;
const OP_ROLE = 'action.provision';
const SVG = 'http://www.w3.org/2000/svg';

const CSS = `
.wp { display: grid; gap: var(--sp-3); min-width: 0; }
.wp [hidden] { display: none !important; }
.wp-list { display: grid; margin: 0; padding: 0; list-style: none; min-width: 0; }
.wp-row { display: flex; align-items: center; gap: var(--sp-3); width: 100%; min-height: var(--tap); padding: 0 var(--sp-2);
  background: none; border: 0; border-bottom: 1px solid var(--line-1); color: var(--tx); font: inherit; text-align: left; cursor: pointer; }
.wp-row:disabled { cursor: default; }
.wp-list[data-stale] .wp-row { opacity: .45; }
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
.wp-manage { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.wp-manage .og-btn { min-height: var(--tap); }
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

  let mode = 'slots', list = null, rows = null, busy = false, waitAt = null, waitTimer = 0, retryTimer = 0, target = null, sig = '', dead = false;
  // view: the rows as drawn (held order); pointer: a press is in the list; granted/grantAt/fresh: the stale rule.
  let view = null, pointer = false, granted = false, grantAt = null, fresh = false, needAsk = false, armed = false, armTimer = 0;
  const rowsBy = new Map(), btnBy = new Map();

  const items = el('ul', 'wp-list');
  items.setAttribute('aria-label', 'Networks');
  let releaseTimer = 0;
  const release = () => {
    if (!pointer) return;
    pointer = false;
    // After the click that ends the press, never between: a rebuild there would eat the tap.
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => { if (!dead) draw(); }, 150);
  };
  items.addEventListener('pointerdown', () => { pointer = true; });
  items.addEventListener('focusout', () => setTimeout(() => { if (!dead) draw(); }, 0));
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
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
  const up = ui.button({ label: COPY.up, onClick: () => manage('move', -1) });
  const down = ui.button({ label: COPY.down, onClick: () => manage('move', 1) });
  const rm = ui.button({ label: COPY.remove, onClick: () => {
    const op = opField();
    if ((op && op.destructiveOptions && op.destructiveOptions[DRAFT.op.remove]) || armed) { disarm(); manage('remove'); return; }
    armed = true;
    rm.label = COPY.sure;
    rm.classList.add('danger');
    armTimer = setTimeout(disarm, ARM_MS);
  } });
  const manageBox = el('div', 'wp-manage');
  manageBox.append(up, down, rm);
  const form = el('div', 'wp-join');
  form.append(head, ssid, pass, manageBox, acts);

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

  function disarm() { clearTimeout(armTimer); armed = false; rm.label = COPY.remove; rm.classList.remove('danger'); }

  function show(t) {
    disarm();
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
    clearTimeout(retryTimer);
    if (mode !== 'list' || busy || waitAt != null || gate()) return;
    const at = scanOf(f, read) ?? 0;
    waitAt = at;
    say(COPY.scanning, '');
    draw();
    const r = await api.write(op, DRAFT.op.scan, {});
    if (!r || !r.ok) {
      stopWait();
      say(scanRefusal(r));
      // ponytail: asked again on a timer; the picker has no motion signal. Upgrade: ask when the machine state says stopped.
      if (isInterlock(r) && !dead) retryTimer = setTimeout(scan, MOTION_RETRY_MS);
      draw();
      return;
    }
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

  // A saved row's sheet: move or remove it by its slot, found again by SSID (a slot number is not an identity).
  async function manage(name, by = 0) {
    const op = opField();
    if (!op || busy || gate() || !target) return;
    const s = slotOf(list, target.ssid);
    if (s < 0) { say(COPY.changed); return; }
    busy = true;
    say('', '');
    draw();
    const extra = name === 'move' ? { [DRAFT.key.to]: s + by } : {};
    const r = await api.write(op, DRAFT.op[name], { [DRAFT.key.generation]: list.generation, [DRAFT.key.slot]: s, ...extra });
    busy = false;
    if (r && r.ok) {
      say(name === 'move' ? COPY.moved : COPY.removed, 'ok');
      if (name === 'remove') target = null;
    } else if (!r || r.error !== 'canceled') say(refusalWords(r) || 'Not saved');
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
    // A saved row never joins on one tap.
    if (row.saved || row.secured) show(row); else act(row.ssid, '');
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
    btnBy.set(row.ssid, b);
    b.addEventListener('click', () => { const r = rowsBy.get(row.ssid); if (r) tap(r); });
    const li = el('li');
    li.append(b);
    return li;
  }

  const held = () => pointer || !!target || !!items.querySelector(':focus-visible');
  // The rows as drawn: the hub's order when nothing is held, else the order on screen with new SSIDs appended
  // and the ones that left kept (a row must not slip from under a finger).
  function arrange() {
    const next = rows || [];
    if (!view || !held()) view = next.slice();
    else {
      const by = new Map(next.map((r) => [r.ssid, r]));
      const kept = view.map((r) => by.get(r.ssid) || r);
      const known = new Set(kept.map((r) => r.ssid));
      view = [...kept, ...next.filter((r) => !known.has(r.ssid))];
    }
    rowsBy.clear();
    for (const r of view) rowsBy.set(r.ssid, r);
  }

  function draw() {
    const g = gate();
    const listing = mode === 'list';
    arrange();
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
      const slot = target.saved ? slotOf(list, target.ssid) : -1;
      manageBox.hidden = !target.saved;
      up.disabled = !!g || busy || slot < 1;
      down.disabled = !!g || busy || slot < 0 || slot >= list.count - 1;
      rm.disabled = !!g || busy || slot < 0;
      head.textContent = target.other ? COPY.other : target.ssid;
      ssid.hidden = !target.other;
      pass.hidden = !target.secured;
      ssid.disabled = pass.disabled = cancel.disabled = busy;
      go.disabled = !!g || busy || (target.other ? !ssid.value : target.secured && !pass.value);
      go.tip = g;
    }
    // Rows are rebuilt only when what a tap acts on changes; a rescan's new signal is patched in place, so a
    // rebuild never lands between a press and its click.
    const stale = !fresh;
    const next = JSON.stringify([view.map((r) => [r.ssid, r.secured, r.saved, !!r.connected]), !!g, busy, stale]);
    // Never mid-press: the click that follows would land on nothing. The release draws again.
    if (next !== sig && !pointer) {
      sig = next;
      btnBy.clear();
      items.replaceChildren(...view.map(rowEl));
    }
    if (stale) items.dataset.stale = ''; else delete items.dataset.stale;
    // Patched by SSID, never by position.
    for (const r of view) {
      const b = btnBy.get(r.ssid);
      if (!b) continue;
      b.disabled = !!g || busy || stale;
      b.dataset.tip = r.rssi != null ? r.rssi + ' dBm' : '';
      b.querySelectorAll('.wp-bars path').forEach((p, k) => p.classList.toggle('off', k >= bars(r.rssi)));
    }
    empty.hidden = view.length > 0 || waitAt != null;
  }

  // The grant: rows already pushed are of unknown age until the scan counter differs from its value here
  // (equality only). A first sample after the grant is the grant's own push.
  function track() {
    if (gate()) { granted = false; return; }
    const at = scanOf(f, read);
    if (!granted) { granted = true; fresh = false; grantAt = at; needAsk = true; }
    else if (!fresh) {
      if (grantAt == null) grantAt = at;
      else if (at != null && at !== grantAt) fresh = true;
    }
  }

  function update() {
    list = readList(f.nets, f.names, read, list);
    rows = f.vis ? readVisible(f, read, list) : null;
    track();
    mode = pickMode();
    if (mode !== 'list' && target) { target = null; pass.value = ''; }
    if (waitAt != null && (scanOf(f, read) ?? 0) !== waitAt) { stopWait(); if (status.textContent === COPY.scanning) say(''); }
    slots.update();
    draw();
    if (mode === 'list' && needAsk) { needAsk = false; scan(); }
  }
  update();

  return {
    update,
    unmount() {
      dead = true;
      stopWait();
      clearTimeout(retryTimer);
      clearTimeout(releaseTimer);
      disarm();
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      pass.value = '';
      slots.unmount();
      root.remove();
    },
  };
}
