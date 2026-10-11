// node src/themes/glass/place.check.mjs: the layer lines up with the desktop.
import assert from 'node:assert/strict';
import { place } from './place.js';

const info = { monitor: [0, 0, 2560, 1440], window: [100, 80, 1428, 900], scale: 2, fit: 'fill' };
// A window at (100, 80) physical on a 2x monitor: the monitor's box starts 50, 40 CSS px up and left.
assert.deepEqual(place(info, { w: 3840, h: 2160 }), { x: -50, y: -40, w: 1280, h: 720, size: 'cover', repeat: 'no-repeat', pos: 'center' });
// A second monitor to the left of the primary: its box starts further left of the window.
assert.equal(place({ ...info, monitor: [-1920, 0, 1920, 1080], window: [-1000, 100, 800, 600], scale: 1 }, { w: 1, h: 1 }).x, -920);
// Center keeps the image's pixel size; tile repeats it from the monitor's corner.
assert.equal(place({ ...info, fit: 'center' }, { w: 800, h: 600 }).size, '400px 300px');
assert.deepEqual(place({ ...info, fit: 'tile' }, { w: 64, h: 64 }), { x: -50, y: -40, w: 1280, h: 720, size: '32px 32px', repeat: 'repeat', pos: '0 0' });
console.log('place: ok');
