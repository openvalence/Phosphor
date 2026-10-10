/**
 * quick-access -- the factory tray (ph-kyjd): Pin to quick access in a
 * module's and a field's context menu, and the pinned modules, live, in one
 * column in the right dock. Built on the public plugin API alone: the worked
 * example of Context menus, The dock and Field-bound controls
 * (docs/PLUGINS.md).
 *
 * Constraints:
 * - Pins are per hub, by identity (api.hub(), the menu target's key), in
 *   api.prefs: a catalog etag change keeps a pin while its control exists,
 *   and one whose control is gone draws ui.module's "not on this machine".
 * - Hidden by default: the dock is registered while the connected hub has
 *   pins (api.onHub), and opens only when the user opens it; the last unpin
 *   on that hub withdraws it, which closes it. With no hub yet (booting,
 *   between hubs) it stays as it is.
 * - None on the phone class: the shell has no dock there, so the host drops
 *   the needsDock item; pins stay stored for the desktop.
 * - A row is built once per pin and moved, never rebuilt, on a reorder, so a
 *   control keeps its in-flight write.
 */
const PINS = 'pins';
const GRIP = 'M6 4.5v0M10 4.5v0M6 8v0M10 8v0M6 11.5v0M10 11.5v0';

/** The pin list with `key` moved by `by` places, clamped to the ends. */
export function movePin(list, key, by) {
  const i = list.findIndex((p) => p.key === key);
  const j = Math.max(0, Math.min(list.length - 1, i + by));
  if (i < 0 || i === j) return list;
  const out = list.slice();
  out.splice(j, 0, out.splice(i, 1)[0]);
  return out;
}

export function activate(api) {
  const ui = api.ui;
  const all = () => { const p = api.prefs.get(PINS); return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; };
  const pinsOf = (hub) => (hub && Array.isArray(all()[hub]) ? all()[hub] : []);
  let withdraw = null, redraw = null;
  const sync = () => {
    const hub = api.hub();
    if (hub != null) {
      const has = pinsOf(hub).length > 0;
      if (has && !withdraw) withdraw = api.registerDock({ id: 'tray', label: 'Quick access', mount });
      else if (!has && withdraw) { withdraw(); withdraw = null; }
    }
    if (redraw) redraw();
  };
  const setPins = (hub, list) => {
    const p = all();
    if (list.length) p[hub] = list; else delete p[hub];
    api.prefs.set(PINS, p);
    sync();
  };
  const pinned = (hub, key) => pinsOf(hub).some((p) => p.key === key);

  api.registerMenu({
    id: 'pin',
    targets: ['module', 'field'],
    needsDock: true,
    label: (t) => (t.hub ? (pinned(t.hub, t.key) ? 'Unpin from quick access' : 'Pin to quick access') : null),
    run: (t) => setPins(t.hub, pinned(t.hub, t.key) ? pinsOf(t.hub).filter((p) => p.key !== t.key)
      : [...pinsOf(t.hub), { key: t.key, kind: t.kind, title: t.title }]),
  });
  api.onHub(sync);
  sync();

  function mount(el) {
    const page = ui.page({});
    const empty = ui.status();
    el.append(page);
    const rows = new Map();
    let hub = null;
    const row = (p) => {
      const x = ui.button({ icon: 'close', title: 'Unpin', class: 'qa-unpin', onClick: () => setPins(hub, pinsOf(hub).filter((q) => q.key !== p.key)) });
      const grip = ui.button({ icon: GRIP, title: 'Drag to reorder', class: 'qa-grip' });
      const card = ui.card({ title: p.title || p.key, actions: [x], class: 'qa-pin' });
      card.dataset.pin = p.key;
      card.head.prepend(grip);
      card.body.append(p.kind === 'field' ? ui.field(p) : ui.module(p));
      // Arrows move a pin one place; a drag on the grip drops it where the pointer is.
      grip.addEventListener('keydown', (e) => {
        const by = { ArrowUp: -1, ArrowDown: 1 }[e.key];
        if (!by) return;
        e.preventDefault();
        setPins(hub, movePin(pinsOf(hub), p.key, by));
        grip.focus();
      });
      let to = -1;
      ui.drag(grip, {
        axis: 'y',
        onMove(e) {
          const kids = [...page.main.children];
          const k = kids.findIndex((c) => e.clientY < c.getBoundingClientRect().bottom);
          to = k < 0 ? kids.length - 1 : k;
          kids.forEach((c, i) => { c.style.boxShadow = i === to && c !== card ? '0 -2px 0 var(--highlight)' : ''; });
        },
        onEnd(e, ok) {
          const kids = [...page.main.children];
          kids.forEach((c) => { c.style.boxShadow = ''; });
          const from = kids.indexOf(card);
          if (ok && to >= 0 && to !== from) setPins(hub, movePin(pinsOf(hub), p.key, to - from));
          to = -1;
        },
      });
      return card;
    };
    const draw = () => {
      hub = api.hub();
      const list = pinsOf(hub);
      for (const [k, r] of rows) if (!list.some((p) => p.key === k)) { r.remove(); rows.delete(k); }
      for (const p of list) if (!rows.has(p.key)) rows.set(p.key, row(p));
      page.main.replaceChildren(...list.map((p) => rows.get(p.key)), ...(list.length ? [] : [empty]));
      empty.set({ text: list.length ? '' : 'Right-click a card to pin it' });
    };
    redraw = draw;
    draw();
    return { update() { if (api.hub() !== hub) draw(); }, unmount() { redraw = null; } };
  }
}
