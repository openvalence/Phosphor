// advanced-penetration -- factory plugin: RENDERING §10 `generator-advanced`
// substituted per RFC-068 (RENDERING §10.2). Layout after fray-d's OSSM-Lite
// (docs/preset.html, advanced_penetration_ui.h); the reading is recorded on
// ph-e82.18.
//
// Constraints:
// - One self-contained ES module, no framework, no imports (docs/PLUGINS.md).
// - Binds by registry role only. `require` is the pattern's whole essential
//   set (RFC-081), so the host never mounts this with less; advgen.mode beside
//   pattern.select is the one conditional essential and is checked in mount.
// - Shows only what api.value reports and writes only through api.write; the
//   host renders every confirm. No control claims a value before the echo.
// - mod.shape is not claimed: it stays a Tier-0 field until a hub emits it.

const STORE_OP = { save: 1, load: 2, delete: 3, rename: 4 };   // registry store_ops (RFC-067)
const CBOR = { uint: 0, tstr: 4 };                             // SPEC §8.1 schema field types

const BASE_LABEL = {
  master: 'Master speed', depthMax: 'Max depth', depthMin: 'Min depth',
  speedIn: 'In speed', speedOut: 'Out speed', accelIn: 'In accel', accelOut: 'Out accel',
};
const MOD_KEYS = ['amount', 'rise', 'hold', 'fall', 'rest', 'phase'];
const MOD_LABEL = { amount: 'Amount', rise: 'Rise', hold: 'Hold', fall: 'Fall', rest: 'Rest', phase: 'Phase' };
const LADDER = {
  pending: 'waiting for the machine',
  overdue: 'still waiting for the machine',
  fault: 'refused by the machine; showing what it reports',
};
const SLOT_TEXT = { pending: 'reading', empty: 'empty', locked: 'locked', error: 'read failed' };

const CSS = `
.ap { display: flex; flex-direction: column; gap: var(--gap); }
.ap section { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--line); padding-top: var(--gap); }
.ap h4 { margin: 0; font-size: .72rem; letter-spacing: .04em; color: var(--tx-mut); font-weight: 600; }
.ap-head { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: flex-start; }
.ap-head > * { flex: 1 1 160px; }
.ap-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 12px 16px; }
.ap-ctl { display: flex; flex-direction: column; }
.ap-ctl label:not(.og-switch) { display: flex; justify-content: space-between; gap: 8px; color: var(--tx); font-size: .85rem; }
.ap-ctl output { font-family: var(--mono); color: var(--tx-val); }
.ap-ctl input[type=range] { margin: 6px 0; }
.ap-note { margin: 0; min-height: 1.1em; font-size: .74rem; color: var(--ink-dim); }
.ap [data-status=pending] output, .ap [data-status=overdue] output { color: var(--tx-ghost); font-style: italic; }
.ap [data-status=fault] .ap-note { color: var(--warn); }
.ap .ap-stale { opacity: .55; }
.ap-sw { min-height: var(--tap); }
.ap-run { min-height: var(--tap); min-width: 96px; }
.ap-pic { width: 100%; max-height: 160px; }
.ap-pic .rail { fill: var(--line-2); }
.ap-pic .win { fill: var(--intent); opacity: .3; }
.ap-pic .in, .ap-pic .out { fill: none; stroke-width: 2; }
.ap-pic .in { stroke: var(--reality); }
.ap-pic .out { stroke: var(--intent); }
.ap-pic text { fill: var(--tx-mut); font-size: 8px; font-family: var(--mono); }
.ap-mod { margin-left: 12px; border-left: 2px solid var(--line); padding-left: 10px; }
.ap-mod summary { display: flex; align-items: center; gap: 10px; min-height: var(--tap); cursor: pointer; color: var(--tx-mut); font-size: .8rem; }
.ap-mod summary svg { width: 96px; height: 24px; flex: 0 0 auto; }
.ap-mod summary polyline { fill: none; stroke: var(--intent); stroke-width: 1.5; }
.ap-mod summary line { stroke: var(--line-2); }
.ap-slots { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; max-height: 260px; overflow: auto; }
.ap-slots button { width: 100%; min-height: var(--tap); display: flex; gap: 10px; align-items: center; text-align: left;
  border: 1px solid var(--line); border-radius: var(--r-s); background: none; color: var(--tx); padding: 0 8px; cursor: pointer; }
.ap-slots button[aria-pressed=true] { border-color: var(--reality); }
.ap-slots .n { font-family: var(--mono); color: var(--tx-ghost); min-width: 2ch; }
.ap-slots [data-state=empty] { border-style: dashed; color: var(--tx-mut); }
.ap-slots [data-state=pending] { color: var(--tx-ghost); font-style: italic; }
.ap-slots [data-state=error] { color: var(--warn); }
.ap-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.ap-row input[type=text], .ap-row input[type=number] { flex: 1 1 140px; min-height: var(--tap); }
.ap-row .og-btn { min-height: var(--tap); }
`;

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
};
const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const num = Number;
const on = (v) => v === true || num(v) === 1;
let seq = 0;

// fray-d calculateStroke: a trapezoid velocity profile over the depth window.
// Speed and accel are taken as fractions of their own range, so the picture
// is a sketch in the protocol's terms, not a simulation of one firmware.
export function strokeTime(span, speed, accel) {
  if (!(span > 0) || !(speed > 0)) return null;
  const a = (speed * speed / span) * (1 + 9 * Math.max(0, accel));
  const tAcc = speed / a;
  const total = 2 * tAcc + Math.max(0, span - a * tAcc * tAcc) / speed;
  return { total, ease: tAcc / total };
}

// RFC-066's cycling trapezoid, 0..1, at time t of one cycle started at `phase`.
export function cycleLevel(t, { rise, hold, fall, rest, phase }) {
  const total = rise + hold + fall + rest;
  if (!(total > 0)) return 0;
  let x = (((t + phase) % total) + total) % total;
  if (x < rise) return x / rise;
  x -= rise;
  if (x < hold) return 1;
  x -= hold;
  if (x < fall) return 1 - x / fall;
  return 0;
}

export function activate(api) {
  api.registerHero({
    id: 'advanced',
    title: 'Advanced Penetration',
    replaces: 'advanced-generator',
    cells: { h: [10, 9], v: [6, 14] },
    spec: {
      require: {
        running: 'pattern.running',
        master: 'advgen.master',
        depthMax: 'advgen.depth_max', depthMin: 'advgen.depth_min',
        speedIn: 'advgen.speed_in', speedOut: 'advgen.speed_out',
        accelIn: 'advgen.accel_in', accelOut: 'advgen.accel_out',
      },
      optional: { bgRun: 'source.background_run', mode: 'advgen.mode', presetOp: 'action.store' },
      // A modulator is one entry carrying all six roles (RFC-066); no minimum.
      instances: {
        mods: { min: 0, roles: { amount: 'mod.amount', rise: 'mod.rise', hold: 'mod.hold',
          fall: 'mod.fall', rest: 'mod.rest', phase: 'mod.phase' } },
      },
    },
    mount(el, fields) {
      if (!fields.mode && api.field('pattern.select')) {
        throw new Error('advgen.mode is essential beside pattern.select (RENDERING §10); the host renders the pattern instead');
      }
      return mountWidget(api, el, fields);
    },
  });
}

function mountWidget(api, el, fields) {
  const updaters = [];
  const fit = (f) => (f.min != null && f.max != null && f.max > f.min ? f : null);

  // ---- one control: slider or switch, with the ladder and the gate in words
  function control(f, label, kind = 'slider') {
    const id = 'ap-' + (++seq);
    const out = h('output', { for: id });
    const note = h('p', { class: 'ap-note', 'aria-live': 'polite' });
    let input;
    let held = false;
    let box;
    if (kind === 'switch') {
      input = h('input', { type: 'checkbox', id });
      box = h('div', { class: 'ap-ctl' },
        h('label', { class: 'og-switch ap-sw', for: id }, input, h('span', { class: 'track' }), h('span', { text: label })), note);
      input.addEventListener('change', () => {
        held = true;
        Promise.resolve(api.write(f, input.checked ? 1 : 0)).finally(() => { held = false; update(); });
      });
    } else {
      input = h('input', { type: 'range', id, min: f.min ?? 0, max: f.max ?? 100, step: f.step || 1 });
      box = h('div', { class: 'ap-ctl' }, h('label', { for: id }, h('span', { text: label }), out), input, note);
      input.addEventListener('input', () => { held = true; out.textContent = fmt(input.value); });
      input.addEventListener('change', () => { held = false; api.write(f, Number(input.value)); });
    }
    const fmt = (v) => (v == null || v === '' ? '--' : String(+Number(v).toFixed(2)) + (f.unit ? ' ' + f.unit : ''));
    function update() {
      const v = api.value(f);
      const st = api.status(f);
      const gate = api.gate(f);
      const stale = api.stale(f);
      box.dataset.status = st;
      box.classList.toggle('ap-stale', !!stale);
      input.disabled = !!gate;
      if (!held) {
        if (kind === 'switch') input.checked = on(v);
        else if (v != null) input.value = num(v);
        out.textContent = fmt(v);
      }
      note.textContent = gate || LADDER[st] || stale || '';
      note.title = stale || '';
    }
    updaters.push(update);
    return box;
  }

  // ---- run/stop: a press asks for the opposite of what the machine reports
  function runButton(f) {
    const btn = h('button', { type: 'button', class: 'og-btn ap-run' });
    const note = h('p', { class: 'ap-note', 'aria-live': 'polite' });
    const box = h('div', { class: 'ap-ctl' }, btn, note);
    btn.addEventListener('click', () => api.write(f, on(api.value(f)) ? 0 : 1));
    updaters.push(() => {
      const st = api.status(f);
      const gate = api.gate(f);
      const stale = api.stale(f);
      box.dataset.status = st;
      box.classList.toggle('ap-stale', !!stale);
      btn.disabled = !!gate;
      btn.textContent = on(api.value(f)) ? 'Stop' : 'Start';
      btn.setAttribute('aria-pressed', String(on(api.value(f))));
      note.textContent = gate || LADDER[st] || stale || (on(api.value(f)) ? 'running' : 'stopped');
    });
    return box;
  }

  // ---- the stroke picture: the window on the rail, the in and out halves
  function strokePicture() {
    const svg = s('svg', { class: 'ap-pic', viewBox: '0 0 240 100', role: 'img' });
    const title = s('title');
    const rail = s('rect', { class: 'rail', x: 8, width: 4, y: 5, height: 90 });
    const win = s('rect', { class: 'win', x: 4, width: 12 });
    const pin = s('path', { class: 'in' });
    const pout = s('path', { class: 'out' });
    const tin = s('text', { y: 98 });
    const tout = s('text', { y: 98 });
    tin.textContent = 'in';
    tout.textContent = 'out';
    svg.append(title, rail, win, pin, pout, tin, tout);
    const frac = (f) => { const v = num(api.value(f)); return fit(f) ? (v - f.min) / (f.max - f.min) : v / 100; };
    updaters.push(() => {
      const lo = Math.min(1, Math.max(0, frac(fields.depthMin)));
      const hi = Math.min(1, Math.max(0, frac(fields.depthMax)));
      const y = (p) => 95 - p * 90;
      win.setAttribute('y', y(Math.max(lo, hi)));
      win.setAttribute('height', Math.abs(hi - lo) * 90);
      const span = hi - lo;
      const tIn = strokeTime(span, frac(fields.speedIn), frac(fields.accelIn));
      const tOut = strokeTime(span, frac(fields.speedOut), frac(fields.accelOut));
      const ok = tIn && tOut;
      pin.style.display = pout.style.display = ok ? '' : 'none';
      if (ok) {
        const x0 = 30, w = 204, x1 = x0 + w * tIn.total / (tIn.total + tOut.total), x2 = x0 + w;
        const seg = (a, b, ya, yb, e) => {
          const d = (b - a) * e;
          return 'M' + a + ' ' + ya + ' C' + (a + d) + ' ' + ya + ' ' + (b - d) + ' ' + yb + ' ' + b + ' ' + yb;
        };
        pin.setAttribute('d', seg(x0, x1, y(lo), y(hi), tIn.ease));
        pout.setAttribute('d', seg(x1, x2, y(hi), y(lo), tOut.ease));
        tin.setAttribute('x', (x0 + x1) / 2 - 4);
        tout.setAttribute('x', (x1 + x2) / 2 - 6);
      }
      const stale = [fields.depthMin, fields.depthMax, fields.speedIn, fields.speedOut].some((f) => api.stale(f));
      svg.classList.toggle('ap-stale', stale);
      title.textContent = ok
        ? 'Stroke between ' + Math.round(lo * 100) + '% and ' + Math.round(hi * 100) + '% of the depth range; the in half takes '
          + Math.round(100 * tIn.total / (tIn.total + tOut.total)) + '% of each stroke'
        : 'No stroke: the depth window or a speed is zero';
    });
    return svg;
  }

  // ---- a modulator: a collapsible group under its target, cycle preview in the summary
  function modulator(m, ridesLabel) {
    const poly = s('polyline');
    const pic = s('svg', { viewBox: '0 0 96 24', 'aria-hidden': 'true' });
    pic.append(s('line', { x1: 0, y1: 22, x2: 96, y2: 22 }), poly);
    const state = h('span');
    const name = (m.amount.group || 'Modulator') + (ridesLabel ? ' (rides ' + ridesLabel + ')' : '');
    const det = h('details', { class: 'ap-mod' }, h('summary', {}, h('span', { text: name }), pic, state),
      h('div', { class: 'ap-grid' }, ...MOD_KEYS.map((k) => control(m[k], MOD_LABEL[k]))));
    updaters.push(() => {
      const val = (k) => Math.max(0, num(api.value(m[k])) || 0);
      const amt = val('amount');
      const top = (m.amount.max || 100);
      const c = { rise: val('rise'), hold: val('hold'), fall: val('fall'), rest: val('rest'), phase: val('phase') };
      const total = c.rise + c.hold + c.fall + c.rest;
      const pts = [];
      for (let i = 0; i <= 48; i++) pts.push((i * 2) + ',' + (22 - 20 * (amt / top) * cycleLevel(total * i / 48, c)).toFixed(1));
      poly.setAttribute('points', pts.join(' '));
      state.textContent = amt ? 'amount ' + amt + (m.amount.unit ? ' ' + m.amount.unit : '') : 'off';
    });
    return det;
  }

  // Each modulator attaches under the base control its mod_target names.
  const base = ['master', 'depthMax', 'depthMin', 'speedIn', 'speedOut', 'accelIn', 'accelOut'];
  const under = new Map(base.map((k) => [fields[k].uid, []]));
  const loose = [];
  for (const m of fields.mods || []) {
    const t = api.modTarget(m.amount);
    if (under.has(t)) under.get(t).push(m); else loose.push({ m, t });
  }
  const withMods = (k) => [control(fields[k], BASE_LABEL[k]), ...under.get(fields[k].uid).map((m) => modulator(m))];
  const section = (title, ...kids) => h('section', {}, h('h4', { text: title }), ...kids);

  const root = h('div', { class: 'ap' }, h('style', { text: CSS }));
  root.append(
    h('div', { class: 'ap-head' },
      runButton(fields.running),
      ...(fields.bgRun ? [control(fields.bgRun, 'Run in background', 'switch')] : []),
      ...(fields.mode ? [control(fields.mode, 'Advanced program', 'switch')] : [])),
    strokePicture(),
    section('Master', ...withMods('master')),
    section('Depth window', ...withMods('depthMax'), ...withMods('depthMin')),
    h('div', { class: 'ap-grid' },
      section('In stroke', ...withMods('speedIn'), ...withMods('accelIn')),
      section('Out stroke', ...withMods('speedOut'), ...withMods('accelOut'))),
  );
  if (loose.length) {
    const label = (uid) => (api.catalog().fields.find((f) => f.uid === uid) || {}).label || 'a field this catalog does not have';
    root.append(section('Other modulators', ...loose.map(({ m, t }) => modulator(m, label(t)))));
  }
  if (fields.presetOp) root.append(presets(api, fields.presetOp, updaters));

  el.append(root);
  const update = () => { for (const u of updaters) u(); };
  update();
  return { update, unmount() { el.replaceChildren(); } };
}

// ---- presets: the store's slots (RFC-070) and its four ops (RFC-067)
function presets(api, op, updaters) {
  // The op's slot and name ride its unroled payload keys; the registry names
  // no role for them, so they are told apart by type (ph-e82.18 notes).
  const slotKey = ((op.payload || []).find((p) => p.type === CBOR.uint) || {}).key;
  const nameKey = ((op.payload || []).find((p) => p.type === CBOR.tstr) || {}).key;
  let slots = null;
  let linked = true;
  let pick = null;
  let reading = false;
  let again = false;

  const list = h('ul', { class: 'ap-slots' });
  const slotNum = h('input', { type: 'number', min: 0, class: 'og-num', 'aria-label': 'Slot number' });
  const name = h('input', { type: 'text', 'aria-label': 'Preset name', placeholder: 'Preset name' });
  const btn = (label, opv) => {
    const b = h('button', { type: 'button', class: 'og-btn', text: label });
    b.addEventListener('click', () => run(opv));
    return b;
  };
  const bSave = btn('Save', STORE_OP.save);
  const bLoad = btn('Load', STORE_OP.load);
  const bRename = btn('Rename', STORE_OP.rename);
  const bDelete = btn('Delete', STORE_OP.delete);
  const reread = h('button', { type: 'button', class: 'og-btn', text: 'Re-read' });
  reread.addEventListener('click', () => read());
  const note = h('p', { class: 'ap-note', 'aria-live': 'polite' });
  const box = h('section', {}, h('h4', { text: 'Presets' }), list,
    h('div', { class: 'ap-row' }, slotNum, name),
    h('div', { class: 'ap-row' }, bSave, bLoad, bRename, bDelete, reread), note);

  const chosen = () => (linked ? pick : (slotNum.value === '' ? null : Number(slotNum.value)));
  async function run(opv) {
    const slot = chosen();
    const payload = {};
    if (slotKey != null && slot != null) payload[slotKey] = slot;
    if (nameKey != null && name.value && (opv === STORE_OP.save || opv === STORE_OP.rename)) payload[nameKey] = name.value;
    const r = await api.write(op, opv, payload);
    if (r && r.ok) read();
  }
  // A read asked for while one runs (an op confirmed mid-read) runs once more after it.
  async function read() {
    if (reading) { again = true; return; }
    reading = true;
    try {
      do {
        again = false;
        slots = await api.storeSlots(op);
        linked = slots !== null;
      } while (again);
    } finally { reading = false; }
    draw();
  }
  function draw() {
    slotNum.style.display = linked ? 'none' : '';
    list.replaceChildren(...(slots || []).map((r) => {
      const b = h('button', { type: 'button', 'data-state': r.state, 'aria-pressed': String(r.slot === pick) },
        h('span', { class: 'n', text: String(r.slot) }),
        h('span', { text: r.state === 'item' ? (r.name || 'unnamed') : SLOT_TEXT[r.state] }));
      b.addEventListener('click', () => {
        pick = r.slot;
        if (r.state === 'item') name.value = r.name || '';
        draw();
      });
      return h('li', {}, b);
    }));
    gateButtons();
  }
  function gateButtons() {
    const gate = api.gate(op);
    const slot = chosen();
    const rec = linked && slots ? slots[slot] : null;
    const filled = !linked || (rec && rec.state === 'item');
    bSave.disabled = !!gate || slot == null;
    bLoad.disabled = bDelete.disabled = !!gate || slot == null || !filled;
    bRename.disabled = !!gate || slot == null || !filled || !name.value;
    const st = api.status(op);
    box.dataset.status = st;
    note.textContent = gate || LADDER[st]
      || (slot == null ? 'pick a slot' : !filled ? 'this slot is empty: save into it' : '')
      || (linked ? '' : 'this store lists no slots (no store_id): enter the slot number');
  }
  name.addEventListener('input', gateButtons);
  slotNum.addEventListener('input', gateButtons);
  // A first read before the link was live came back all pending: read again once it is.
  updaters.push(() => {
    if (!reading && slots && slots.every((r) => r.state === 'pending') && !api.gate(op)) read();
    gateButtons();
  });
  read();
  return box;
}
