/**
 * saved-networks -- the hub's saved WiFi list on the Network page (RFC-116 draft): names, signal and
 * the live entry at configure, add, remove and drag-to-reorder; occupancy only below it.
 *
 * Constraints:
 * - Built on the public plugin API alone. Every write is one provisioning intent through api.write, so
 *   the shell's pending, echo and refusal ladder applies; each carries the generation last read (CAS).
 * - The passphrase field is write-only: read once at send, cleared at once, never kept, logged or shown.
 * - The hub decides: no row is moved, added or dropped until its STATE says so, and a refusal is the
 *   hub's reason in the card's one status line. The live entry's Remove is not pre-disabled.
 * - A write stale against the list is retried once on the next list, the entry found again by SSID:
 *   a slot number is not an identity.
 * - Remove asks first. A catalog that flags the op destructive makes the host ask; one that does not
 *   gets the two-tap confirm below.
 */
import { DRAFT, passphraseProblem, ssidProblem, readList, occupancy, refusalWords, isConflict, slotOf } from './wire.js';

const COPY = {
  hint: 'Order matters for hidden networks and near ties',
  add: 'Add',
  remove: 'Remove',
  sure: 'Confirm',
  ssid: 'Name',
  pass: 'Passphrase',
  full: 'List full',
  up: 'Move up',
  down: 'Move down',
  changed: 'List changed, check and retry',
};
const ARM_MS = 4000;
const NEWER_MS = 2000;
const OP_ROLE = 'action.provision';

const CSS = `
.sn { --ui-row-h: 3rem; display: grid; gap: var(--sp-3); min-width: 0; }
.sn [hidden] { display: none !important; }
.sn-sum { margin: 0; font: .78rem var(--mono); color: var(--tx-val); }
.sn-list { min-width: 0; }
.sn .ui-list[data-form='rows'] .ui-tile-b { grid-template-columns: 2.25rem minmax(0, 1fr); }
.sn .ui-tile-shot { display: grid; place-items: center; font: .8rem var(--mono); color: var(--tx-mut); }
.sn .ui-tile-b[aria-current='true'] .ui-tile-shot { color: var(--tx); }
.sn .ui-tile-act { display: flex; gap: var(--sp-1); }
.sn .ui-tile-act .og-btn.rm { min-width: 5.5rem; }
.sn-hint { margin: 0; color: var(--ink-dim); font-size: .78rem; }
.sn-form { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.sn-form .value-input { flex: 1 1 9rem; min-width: 0; }
.sn-form .og-btn { flex: 0 0 auto; min-width: 5.5rem; }
.sn-status { margin: 0; min-height: 1.1rem; font-size: .78rem; line-height: 1.1rem; color: var(--ink-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sn-status[data-tone='warn'] { color: var(--warn-ink); }
`;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export function mountSlots(api, host, f) {
  const ui = api.ui;
  const opField = () => api.field(OP_ROLE);
  const read = (field) => api.value(field);

  let list = null, busy = false, armed = -1, armTimer = 0, sig = '';

  const sum = el('p', 'sn-sum');
  const rows = ui.list({ form: 'rows', paged: false, class: 'sn-list', onMove: (from, to) => move(from, to) });
  const hint = el('p', 'sn-hint', COPY.hint);
  const ssid = ui.text({ placeholder: COPY.ssid, label: COPY.ssid });
  const pass = ui.text({ type: 'password', placeholder: COPY.pass, label: COPY.pass });
  const add = ui.button({ label: COPY.add, tone: 'primary', onClick: () => submit() });
  const form = el('div', 'sn-form');
  form.append(ssid, pass, add);
  const status = el('p', 'sn-status');
  status.setAttribute('role', 'status');
  const root = el('div', 'sn');
  root.append(el('style', null, CSS), sum, rows, hint, form, status);
  host.append(root);

  const say = (text) => { status.textContent = text; if (text) status.dataset.tone = 'warn'; else delete status.dataset.tone; };
  // The gate's words: '' when this session may write the op now.
  const gate = () => { const op = opField(); return op ? api.gate(op) : 'Not on this hub'; };
  const destructiveAsked = () => { const op = opField(); return !!(op && op.destructiveOptions && op.destructiveOptions[DRAFT.op.remove]); };

  // plan(list) -> the op's fields for that list, {skip: true} when nothing is left to do, null when the
  // target is gone. A stale generation waits for a newer list (bounded) and plans again, once.
  async function act(name, plan) {
    const op = opField();
    if (!op || busy || gate()) return { ok: false };
    busy = true;
    draw();
    let r = { ok: false };
    say('');
    for (let attempt = 0; attempt < 2; attempt++) {
      const at = list;
      const extra = plan(at);
      if (!extra) { say(COPY.changed); break; }
      if (extra.skip) { r = { ok: true }; break; }
      r = await api.write(op, DRAFT.op[name], { [DRAFT.key.generation]: at ? at.generation : 0, ...extra });
      if (!isConflict(r) || attempt || !(await newer(at && at.generation))) break;
    }
    busy = false;
    if (!r.ok && r.error !== 'canceled' && !status.textContent) say(refusalWords(r));
    draw();
    return r;
  }

  // Resolves true when a named list of another generation shows, false after NEWER_MS.
  const waiters = new Set();
  const newer = (gen) => new Promise((done) => {
    const w = { gen, done: (v) => { clearTimeout(t); waiters.delete(w); done(v); } };
    const t = setTimeout(() => w.done(false), NEWER_MS);
    waiters.add(w);
    if (list && list.named && list.generation !== gen) w.done(true);
  });

  const remove = (entry) => act('remove', (l) => { const s = slotOf(l, entry.ssid); return s < 0 ? null : { [DRAFT.key.slot]: s }; });
  const move = (from, to) => {
    const ssid = list && list.entries[from] && list.entries[from].ssid;
    return act('move', (l) => {
      const s = slotOf(l, ssid);
      if (s < 0) return null;
      const t = Math.min(to, l.count - 1);
      return s === t ? { skip: true } : { [DRAFT.key.slot]: s, [DRAFT.key.to]: t };
    });
  };

  async function submit() {
    // Read once and clear before the send: the field never holds a secret across the wire.
    const secret = pass.value;
    pass.value = '';
    const name = ssid.value;
    const r = await act('save', () => ({ [DRAFT.key.ssid]: name, [DRAFT.key.passphrase]: secret }));
    if (r && r.ok) ssid.value = '';
    draw();
  }
  for (const input of [ssid, pass]) {
    input.addEventListener('input', draw);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !add.disabled) submit(); });
  }

  const disarm = () => { clearTimeout(armTimer); armed = -1; };
  function removeButton(entry) {
    const b = ui.button({ label: COPY.remove, class: 'rm' });
    b.addEventListener('click', () => {
      if (destructiveAsked() || armed === entry.slot) { disarm(); b.label = COPY.remove; b.classList.remove('danger'); remove(entry); return; }
      disarm();
      armed = entry.slot;
      b.label = COPY.sure;
      b.classList.add('danger');
      armTimer = setTimeout(() => { armed = -1; b.label = COPY.remove; b.classList.remove('danger'); }, ARM_MS);
    });
    return b;
  }

  const step = (entry, by) => {
    const b = ui.button({ icon: by < 0 ? 'up' : 'down', title: by < 0 ? COPY.up : COPY.down });
    b.addEventListener('click', () => move(entry.slot, entry.slot + by));
    b.disabled = entry.slot + by < 0 || entry.slot + by >= list.count;
    return b;
  };

  function meta(entry) {
    const parts = [];
    if (entry.live) parts.push('connected');
    parts.push(entry.rssi != null ? entry.rssi + ' dBm' : 'not heard');
    if (entry.open) parts.push('open');
    return parts.join(' · ');
  }

  function draw() {
    const g = gate();
    const named = !!(list && list.named);
    sum.textContent = list ? occupancy(list) : '–';
    hint.hidden = !named;
    form.hidden = !named;
    rows.hidden = !named;
    if (named) {
      rows.style.minHeight = 'calc(var(--ui-row-h) * ' + list.capacity + ' + var(--sp-3) * ' + Math.max(0, list.capacity - 1) + ')';
      const same = list.entries.some((e) => e.ssid === ssid.value);
      const problem = !ssid.value ? '' : ssidProblem(ssid.value) || passphraseProblem(pass.value)
        || (list.count >= list.capacity && !same ? COPY.full : '');
      ssid.disabled = pass.disabled = !!g || busy;
      add.disabled = !!g || busy || !ssid.value || !!problem;
      add.tip = g || problem;
      const rule = passphraseProblem(pass.value);
      if (rule) pass.dataset.tip = rule; else delete pass.dataset.tip;
    }
    // Rows are rebuilt only when their structure changes (the signal is rewritten in place): a rebuild
    // mid-drag or mid-confirm would drop it.
    const next = JSON.stringify([named ? list.entries.map((e) => [e.ssid, e.live, e.open]) : null, !!g, busy]);
    if (next !== sig) {
      sig = next;
      disarm();
      if (named) {
        rows.show(list.entries.map((e) => {
          const t = ui.tile({ title: e.ssid, meta: meta(e), current: e.live, actions: [step(e, -1), step(e, 1), removeButton(e)] });
          t.querySelector('.ui-tile-shot').textContent = String(e.slot + 1);
          if (g || busy) for (const b of t.querySelectorAll('.ui-tile-act .og-btn')) b.disabled = true;
          return t;
        }), list.count);
      }
    }
    if (named) rows.querySelectorAll('.ui-tile-m').forEach((m, i) => { if (list.entries[i]) m.textContent = meta(list.entries[i]); });
  }

  function update() {
    list = readList(f.nets, f.names, read, list);
    for (const w of [...waiters]) if (list && list.named && list.generation !== w.gen) w.done(true);
    draw();
  }
  update();

  return {
    update,
    unmount() { disarm(); pass.value = ''; root.remove(); },
  };
}
