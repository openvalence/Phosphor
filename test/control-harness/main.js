// Test-only entry for test/control-contract.test.mjs: the real model and the
// real controls, mounted without App so one field can be drawn in every
// presentation side by side. Never shipped; the app bundle never imports it.
import { mount } from 'svelte';
import '../../src/style.css';
import { connect } from '../../src/model/machine.svelte.js';
import Harness from './Harness.svelte';

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
