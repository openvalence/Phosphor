// Test-only entry for test/control-contract.test.mjs: the real model and the
// real controls, mounted without App so one field can be drawn in every
// presentation side by side. Never shipped; the app bundle never imports it.
import { mount } from 'svelte';
import '../../src/style.css';
import '../../src/ui/still.svelte.js';
import { connect, machine } from '../../src/model/machine.svelte.js';
import { inFlight } from '../../src/model/shadow.svelte.js';
import { placeableControls } from '../../src/model/settings.js';
import Harness from './Harness.svelte';

// The model's in-flight tally over fields named by uid or placeable key (ph-sbu).
window.__inFlight = (keys) => {
  const m = machine.catalog.model;
  const find = (k) => m.fields.find((f) => f.uid === k) || (placeableControls(m).find((c) => c.key === k) || {}).field;
  return inFlight(keys.map(find).filter(Boolean));
};

const q = new URLSearchParams(location.search);
const [host, port] = (q.get('hub') || '127.0.0.1').split(':');
connect({ host, port: port ? Number(port) : undefined });
mount(Harness, {
  target: document.getElementById('app'),
  props: {
    uid: q.get('uid'),
    pres: (q.get('pres') || '').split(',').filter(Boolean),
    action: q.get('action'),
    more: (q.get('more') || '').split(',').filter(Boolean),
  },
});
