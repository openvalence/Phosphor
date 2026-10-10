// kit-demo -- the UI kit (api.ui) in one page and one settings card (docs/PLUGINS.md, The UI kit).
// Constraints: draws nothing of its own; every element and rule is the kit's. The status carries conditions
// only (a warning, a refusal), never what the page already shows (docs/PLUGINS.md, Pages, `status`).
export function activate(api) {
  const ui = api.ui;
  const pref = (k, d) => api.prefs.get(k) ?? d;
  const save = (k) => (v) => api.prefs.set(k, v);
  const settings = () => {
    const r = ui.rows({ title: 'Demo' });
    r.append(
      ui.row({ label: 'Enabled', control: ui.switch({ value: pref('on', true), onChange: save('on') }) }),
      ui.row({ label: 'Speed', control: ui.slider({ min: 0, max: 100, step: 1, value: pref('speed', 50), format: (v) => v + ' %', onChange: save('speed') }) }),
      ui.row({ label: 'Mode', control: ui.select({ options: [{ value: 'smooth', label: 'Smooth' }, { value: 'sharp', label: 'Sharp' }],
        value: pref('mode', 'smooth'), onChange: save('mode') }) }),
    );
    return r;
  };
  api.registerSettings((el) => { const r = settings(); el.append(r); return () => r.remove(); });

  api.registerPage({ id: 'demo', label: 'Kit demo', status: true, mount(el) {
    const status = ui.status();
    const sheet = ui.sheet({ title: 'Settings', onClose: () => { gear.pressed = false; } });
    const gear = ui.button({ icon: 'gear', title: 'Settings', pressed: false, onClick: () => { sheet.open = gear.pressed; } });
    const pos = ui.scrub({ max: 100, label: 'Position' });
    const count = ui.stepper({ min: 0, max: 10, value: 3, label: 'Count',
      onChange: (v) => status.set(v > 8 ? { text: 'Count past 8', tone: 'warn' } : { text: '' }) });
    const start = ui.button({ icon: 'play', label: 'Start', tone: 'primary', onClick: () => { pos.value = 0; } });
    const card = ui.card({ index: '01', title: 'Demo', actions: [gear] });
    card.body.append(ui.bar({ left: [start], center: [pos], right: [count, ui.quickRail()], drop: [count] }), status);
    sheet.body.append(settings());
    el.append(ui.page({ main: [card] }), sheet);
    return { update() {}, unmount() { sheet.open = false; } };
  } });
}
