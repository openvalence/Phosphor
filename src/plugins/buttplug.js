/**
 * buttplug.js — the embedded buttplug server's machine, on the intent path.
 *
 * Constraints:
 * - Registers with the plugin host as a built-in adapter, so `bp://motion`
 *   reaches the kernel through api.submitMotion: the TCode adapter's door,
 *   its `motion` permission, its error boundary and its log (DESIGN §10.8).
 * - A stop sends nothing. The machine holds at its last target; stopping the
 *   machine is the operator's strip pause or e-stop, which the hub latches
 *   and which no app's StopDeviceCmd can clear (docs/BUTTPLUG.md).
 * - Never re-arms. While the hub reports PAUSE (or an e-stop) the motion door
 *   refuses every payload with 'paused, resume to continue', logged once;
 *   motion flows again only after the operator's own Resume (SPEC §11.1).
 *   No app command and no stream data ever sends resume.
 * - Toys the server finds are this adapter's heroes (buttplug-toys.js), so
 *   they place as hero:plugin:buttplug:<toy key> and leave with the adapter.
 * - Shell only: the server is src-tauri/src/buttplug.rs.
 * See: docs/BUTTPLUG.md
 */

export const manifest = {
  name: 'buttplug',
  version: '0.1.0',
  api: 1,
  kind: 'adapter',
  description: 'Buttplug server for Intiface apps on 127.0.0.1',
  roles: [],
  channels: [],
  permissions: ['motion'],
};

/** One bp://motion payload into the intent path: submitMotion's result, or null for a stop. */
export function onMotion(api, p) {
  if (!p || p.stop) return null;
  return api.submitMotion(p.position, p.ms);
}

/**
 * @param {Object} api the plugin API
 * @param {{listen: Function, invoke: Function, live: () => boolean}} shell
 * @returns {() => void} deactivate
 */
export function bridge(api, shell) {
  let lastReason = '';
  let present = false;
  let closed = false;
  const offs = [];
  // No event plugin (a shell without it): degraded, logged once, never thrown.
  let deaf = false;
  const on = (ev, fn) => shell.listen(ev, fn).then((off) => (closed ? off() : offs.push(off)))
    .catch((e) => { if (!deaf) api.log(ev + ': ' + (e && e.message || e), 'error'); deaf = true; });

  on('bp://motion', (e) => {
    if (e.payload && e.payload.stop) { api.log('client stop: holding at the last target'); return; }
    const r = onMotion(api, e.payload);
    if (r && !r.ok) {
      if (r.reason !== lastReason) api.log('motion refused: ' + r.reason, 'warn');
      lastReason = r.reason;
    } else {
      lastReason = '';
    }
  });
  on('bp://log', (e) => e.payload && api.log(e.payload.msg, e.payload.level));

  const setPresent = (v) => {
    present = v;
    shell.invoke('bp_machine_present', { present: v }).catch((e) => api.log('bp_machine_present: ' + e, 'error'));
  };
  // ponytail: polls the link phase at 2 Hz; a link-change hook exported from
  // machine.svelte.js would replace this.
  const tick = () => { const live = !!shell.live(); if (live !== present) setPresent(live); };
  tick();
  const timer = setInterval(tick, 500);

  return () => {
    closed = true;
    clearInterval(timer);
    for (const off of offs.splice(0)) off();
    if (present) setPresent(false);
  };
}

/** Add the adapter to the app's plugin host. Shell only. */
export async function loadButtplug() {
  const [{ host }, { machine }, { invoke }, { listen }, { mount, unmount }, { toyModules }, { default: ToyModule }] = await Promise.all([
    import('./plugins.svelte.js'),
    import('../model/machine.svelte.js'),
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
    import('svelte'),
    import('./buttplug-toys.js'),
    import('../ui/hero/ToyModule.svelte'),
  ]);
  const shell = { listen, invoke, live: () => machine.link.phase === 'live' };
  const render = (el, toy) => {
    const c = mount(ToyModule, { target: el, props: { toy, shell } });
    return { unmount: () => unmount(c) };
  };
  host.add(manifest, {
    activate: (api) => {
      const offMachine = bridge(api, shell);
      const offToys = toyModules(api, shell, render);
      return () => { offToys(); offMachine(); };
    },
  }, { source: 'built-in' });
}
