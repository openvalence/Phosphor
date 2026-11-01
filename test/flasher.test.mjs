/**
 * flasher.test.mjs -- the flasher's logic (src/model/firmware.js, DESIGN
 * §10.19) under node: the image checks, the origin label, the refusal words,
 * the /diag verdict, and the flow against a fake machine.
 *
 * Run: node test/flasher.test.mjs            (no device needed)
 *      node test/flasher.test.mjs --bench    (also arms 192.168.1.118 and lets it expire)
 * --bench sends no image: it arms, polls, posts an unapproved id with an
 * empty body, and reads /diag. The machine must be idle.
 */
import { existsSync, readFileSync } from 'node:fs';
import {
  readImage, originOf, diagHead, verdict, refusal, blank, createFlasher, sha256, FW_INDEX, runningBoard, boardClash,
} from '../src/model/firmware.js';

let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra !== undefined ? '  -- ' + extra : '')); if (!c) fails++; };

// A minimal image: header (chip at 12), one segment header, the app description.
function image({ magic = 0xe9, chip = 0x12, project = 'flagship_p4', version = '0.1.60-p4hub', desc = 'nucleus-p4/abc1234', size = 4096 } = {}) {
  const b = new Uint8Array(size);
  const dv = new DataView(b.buffer);
  b[0] = magic;
  dv.setUint16(12, chip, true);
  dv.setUint32(32, 0xabcd5432, true);
  const put = (o, s) => b.set(new TextEncoder().encode(s), o);
  put(48, desc);
  put(80, project);
  put(128, 'Oct 18 2026');
  if (version) put(1000, version);
  return b;
}

console.log('\n--- image checks ---');
const good = readImage(image());
ok('a P4 Nucleus image reads its facts', good.project === 'flagship_p4' && good.version === '0.1.60-p4hub' && good.build === 'abc1234' && good.date === 'Oct 18 2026' && !good.error, JSON.stringify(good));
ok('wrong magic', /Not a firmware image/.test(readImage(image({ magic: 0x7f })).error));
ok('an S3 image names its chip', readImage(image({ chip: 9 })).error === 'Built for ESP32-S3: pick a P4 image');
ok('another project', /Not Nucleus firmware \(garnet\)/.test(readImage(image({ project: 'garnet' })).error));
ok('no version string reads null, not an error', readImage(image({ version: '' })).version === null && !readImage(image({ version: '' })).error);
ok('the board is the descriptor\'s product', good.product === 'nucleus-p4' && good.board === 'Flagship');
const barn = readImage(image({ desc: 'nucleus-p4b/abc1234-dirty' }));
ok('a barnacle image reads Barnacle and its build', barn.board === 'Barnacle' && barn.build === 'abc1234-dirty', JSON.stringify(barn));
const old = readImage(image({ desc: '57716f1-dirty' }));
ok('an image from before the board names none, not an error', old.board === null && old.product === null && old.build === '57716f1-dirty' && !old.error, JSON.stringify(old));
ok('an unknown product names itself', readImage(image({ desc: 'nucleus-p4c/abc' })).board === 'nucleus-p4c');

console.log('\n--- board ---');
ok('/diag versions name their board', runningBoard('0.1.80-p4hub') === 'Flagship' && runningBoard('0.1.80-p4hub-bench') === 'Flagship'
  && runningBoard('0.1.80-p4hub-barnacle') === 'Barnacle' && runningBoard('garnet-0.1') === null && runningBoard(undefined) === null);
const on = (version) => ({ version, slot: 'ota_0', img: 'valid', up: 9 });
ok('same board: nothing said', boardClash(good, on('0.1.80-p4hub-bench')) === '' && boardClash(barn, on('0.1.80-p4hub-barnacle')) === '');
ok('barnacle image on a Flagship', boardClash(barn, on('0.1.80-p4hub')) === 'Barnacle image on a Flagship: the machine refuses it');
ok('Flagship image on a barnacle', boardClash(good, on('0.1.80-p4hub-barnacle')) === 'Flagship image on a Barnacle: the machine refuses it');
ok('no board: USB', boardClash(old, on('0.1.80-p4hub')) === 'Image names no board: the machine refuses it, use USB' && boardClash(old, null) === boardClash(old, on('x')));
ok('machine not read yet: nothing said', boardClash(barn, null) === '' && boardClash(barn, on('odd')) === '');
ok('a failed pick says nothing here', boardClash({ error: 'x' }, on('0.1.80-p4hub')) === '' && boardClash(null, null) === '');
ok('the hub\'s board refusal reads verbatim', refusal(409, 'image is for the barnacle, this machine is a Flagship') === 'Image is for the barnacle, this machine is a Flagship'
  && refusal(409, 'image names no board (an older build): flash it over USB') === 'Image names no board (an older build): flash it over USB');
const BENCH = new URL('../../Nucleus/flagship_p4/.pio/build/flagship_p4_bench/firmware.bin', import.meta.url);
if (existsSync(BENCH)) {
  const r = readImage(new Uint8Array(readFileSync(BENCH)));
  ok('the bench build reads as Nucleus P4 with its compiled version', r.project === 'flagship_p4' && /-p4hub-bench$/.test(r.version || '') && r.board !== 'Barnacle', JSON.stringify(r));
}

console.log('\n--- origin ---');
const HASH = await sha256(image());
// The site's index (openvalence.github.io tools/fw_index.py): { releases: [{ product, version, tag, prerelease, files: [{ name, role, sha256 }] }] }.
const gh = (releases, status = 200) => ({ get: async (u) => {
  if (u !== FW_INDEX) return { status: 404, text: '' };
  return releases instanceof Error ? Promise.reject(releases) : { status, text: typeof releases === 'string' ? releases : JSON.stringify({ releases }) };
} });
const file1 = (sha256, name = 'nucleus-p4b-0.1.79-app.bin') => ({ name, role: 'app', size: 4096, sha256 });
const rel = [
  { product: 'barnacle-shim', version: '0.1.78', tag: 'barnacle-shim-0.1.78', prerelease: true, files: [file1('ab'.repeat(32), 'barnacle-shim-0.1.78.bin')] },
  { product: 'nucleus-p4b', version: '0.1.79', tag: 'nucleus-p4b-0.1.79', prerelease: true, files: [file1('ef'.repeat(32), 'bootloader.bin'), file1(HASH.toUpperCase())] },
  { product: 'nucleus-p4', version: '0.1.80', tag: 'nucleus-p4-0.1.80', prerelease: false, files: [file1('12'.repeat(32), 'nucleus-p4-0.1.80-app.bin')] },
];
ok('a match names the board, the version and a prerelease', (await originOf(HASH, gh(rel))).label === 'Official Barnacle 0.1.79 · prerelease', (await originOf(HASH, gh(rel))).label);
ok('a release match reads without the flag', (await originOf('12'.repeat(32), gh(rel))).label === 'Official Flagship 0.1.80');
ok('no match is Unrecognized build', (await originOf('cd'.repeat(32), gh(rel))).kind === 'unrecognized');
ok('no releases: cannot check', (await originOf(HASH, gh([]))).label === "Can't check: no published checksums");
ok('the site down: cannot check', (await originOf(HASH, gh(new Error('offline')))).label === "Can't check: openvalence.org didn't answer");
ok('a 404 or a broken index: cannot check', (await originOf(HASH, gh(rel, 404))).kind === 'unknown' && (await originOf(HASH, gh('<html>'))).kind === 'unknown'
  && (await originOf(HASH, gh('{"other":1}'))).label === "Can't check: no published checksums");

console.log('\n--- the machine in plain words ---');
ok('motion running', refusal(409, 'motion is running: stop the machine first') === 'Motion is running: stop the machine first');
ok('motor power on', refusal(409, 'motor power is on: latch the E-stop first') === 'Motor power is on: latch the E-stop first');
ok('another request', refusal(409, 'another update request is waiting for its PAIR double press') === 'Another request is open: try again in a minute');
ok('403', refusal(403, 'not approved: POST /ota/arm, then double-press PAIR on the machine') === 'Not approved: press Update, then double-press PAIR');
ok('404 on arm', refusal(404, '', 'arm') === 'This machine takes no network updates');
ok('400 names the reason', refusal(400, 'ESP_ERR_OTA_VALIDATE_FAILED') === 'The machine refused the image (ESP_ERR_OTA_VALIDATE_FAILED): pick another .bin');
ok('nothing answered', /^No answer from the machine/.test(refusal(null)));

console.log('\n--- /diag ---');
const HEAD = '# nucleus-p4 0.1.58-p4hub-bench git=57716f1-dirty slot=ota_0 img=valid boot=2 reset=software up=72s\n# archive';
ok('the header parses', JSON.stringify(diagHead(HEAD)) === '{"version":"0.1.58-p4hub-bench","slot":"ota_0","img":"valid","up":72}');
const before = diagHead(HEAD);
ok('the old boot still up: no verdict', verdict(before, { ...before, up: 80 }, 3) === null);
ok('new slot, bought: done', verdict(before, { ...before, slot: 'ota_1', up: 10 }, 20) === 'done');
ok('new slot, pending: trial', verdict(before, { ...before, slot: 'ota_1', img: 'pending', up: 5 }, 20) === 'trial');
ok('restarted onto the old slot: rollback', verdict(before, { ...before, up: 4 }, 40) === 'rollback');

console.log('\n--- the flow against a fake machine ---');
// The machine: idle unless told; arm answers pending for `pressAfter` polls, then approved.
function fakeMachine({ armStatus = 202, armText = '', pressAfter = 2, expire = false, upload = 200, after = 'done' } = {}) {
  let polls = 0, uploaded = false, diags = 0;
  const m = { log: [] };
  m.net = {
    get: async (u) => {
      m.log.push('GET ' + u.replace(/^http:\/\/[^/]+/, ''));
      if (u.includes('/diag')) {
        if (!uploaded) return { status: 200, text: HEAD };
        if (++diags < 2) throw new Error('restarting');
        const slot = after === 'rollback' ? 'ota_0' : 'ota_1';
        const ver = after === 'rollback' ? '0.1.58-p4hub-bench' : '0.1.60-p4hub';
        return { status: 200, text: `# nucleus-p4 ${ver} git=x slot=${slot} img=valid boot=1 reset=sw up=3s` };
      }
      if (u.includes('/ota/arm?id=')) return { status: 200, text: JSON.stringify({ state: expire ? 'expired' : ++polls > pressAfter ? 'approved' : 'pending' }) };
      return gh([]).get(u);
    },
    post: async (u) => { m.log.push('POST ' + u.replace(/^http:\/\/[^/]+/, '')); return { status: armStatus, text: armText || '{"id":"0badf00d","window_s":60}' }; },
    upload: async (host, id, bytes, onSent) => { m.log.push('UPLOAD ' + id + ' ' + bytes.length); onSent(bytes.length / 2); uploaded = true; return { status: upload, text: upload === 200 ? 'ok slot=ota_1' : 'not approved' }; },
  };
  return m;
}
const file = { name: 'fw.bin', size: 4096, arrayBuffer: async () => image().buffer };
let t = 0;
const clock = { sleep: async (ms) => { t += ms; }, now: () => t };
async function runFlow(opts) {
  const m = fakeMachine(opts);
  const st = blank();
  const f = createFlasher(st, m.net, clock);
  await f.pick(file);
  const seen = [st.phase];
  await f.update('10.0.0.5');
  return { st, m, seen };
}
{
  const { st, m } = await runFlow({});
  ok('done: arm, poll until approved, upload, restart, bought', st.phase === 'done' && st.status === 'Updated to 0.1.60-p4hub' && st.running.slot === 'ota_1', st.status);
  ok('the upload carries the armed id', m.log.includes('UPLOAD 0badf00d 4096'), m.log.join(' | '));
  ok('origin labeled before the flow', st.origin.label === "Can't check: no published checksums");
}
{
  const { st } = await runFlow({ after: 'rollback' });
  ok('rollback is said plainly', st.phase === 'failed' && st.status === 'The new firmware failed to start: back on 0.1.58-p4hub-bench', st.status);
}
{
  const { st, m } = await runFlow({ expire: true });
  ok('expired: the window closed, nothing sent', st.status === 'The window closed: try again' && !m.log.some((l) => l.startsWith('UPLOAD')), st.status);
}
{
  const { st, m } = await runFlow({ armStatus: 409, armText: 'motor power is on: latch the E-stop first' });
  ok('409 on arm: refusal, no poll', st.status === 'Motor power is on: latch the E-stop first' && st.tone === 'fault' && !m.log.some((l) => l.includes('?id=')), st.status);
}
{
  const { st } = await runFlow({ upload: 403 });
  ok('403 on upload speaks', st.status === 'Not approved: press Update, then double-press PAIR', st.status);
}
{
  const m = fakeMachine({ pressAfter: 1e9 });
  const st = blank();
  const f = createFlasher(st, m.net, { sleep: async () => { t += 1000; if (st.phase === 'waiting' && /PAIR/.test(st.status)) f.cancel(); }, now: () => t });
  await f.pick(file);
  await f.update('10.0.0.5');
  ok('cancel ends the wait, file kept', st.phase === 'ready' && st.status === 'Canceled' && !m.log.some((l) => l.startsWith('UPLOAD')), st.phase + ' ' + st.status);
}
{
  const st = blank();
  const f = createFlasher(st, fakeMachine().net, clock);
  await f.pick({ name: 's3.bin', size: 4096, arrayBuffer: async () => image({ chip: 9 }).buffer });
  ok('a wrong image fails at pick and asks the site nothing', st.phase === 'failed' && st.status === 'Built for ESP32-S3: pick a P4 image' && st.origin === null);
}
{
  const st = blank();
  const f = createFlasher(st, fakeMachine().net, clock);
  await f.pick({ name: 'gone.bin', size: 1, arrayBuffer: async () => { throw new Error('revoked'); } });
  ok('an unreadable file fails, not busy', st.phase === 'failed' && st.status === "Can't read the file: pick it again" && !f.busy());
}
{
  // The origin lookup is still out when Update is pressed: it still lands.
  let release;
  const m = fakeMachine();
  const slowGet = m.net.get;
  m.net.get = (u) => (u === FW_INDEX ? new Promise((r) => { release = () => r({ status: 200, text: '{"releases":[]}' }); }) : slowGet(u));
  const st = blank();
  const f = createFlasher(st, m.net, clock);
  const picking = f.pick(file);
  await new Promise((r) => setTimeout(r, 20));
  const flow = f.update('10.0.0.5');
  release();
  await picking; await flow;
  ok('an origin lookup outlives the flow it overlaps', st.origin.label === "Can't check: no published checksums", JSON.stringify(st.origin));
}
{
  // Approved, uploaded, then the new slot answers pending twice before it buys itself.
  const m = fakeMachine();
  let n = 0;
  const get = m.net.get;
  m.net.get = async (u) => {
    const r = await get(u);
    if (u.includes('/diag') && /slot=ota_1/.test(r.text) && ++n <= 2) return { status: 200, text: r.text.replace('img=valid', 'img=pending') };
    return r;
  };
  const st = blank();
  const said = [];
  const f = createFlasher(st, m.net, { sleep: async (ms) => { said.push(st.status); t += ms; }, now: () => t });
  await f.pick(file);
  await f.update('10.0.0.5');
  ok('on trial the slot reads Confirming <version>', said.includes('Confirming 0.1.60-p4hub') && st.phase === 'done', said.slice(-4).join(' | '));
}
{
  const st = blank();
  const f = createFlasher(st, fakeMachine().net, clock);
  await f.peek('10.0.0.5');
  await f.pick(file);
  st.status = 'Updated to 0.1.60-p4hub';
  await f.peek('10.0.0.9');
  ok('another machine clears the card before its own reading lands', st.host === '10.0.0.9' && st.file === null && st.status === '' && st.running?.slot === 'ota_0');
}

// ---- the bench: arm, poll, an unapproved post, /diag; no image is sent ----
if (process.argv.includes('--bench')) {
  console.log('\n--- bench 192.168.1.118 ---');
  const IP = 'http://192.168.1.118';
  const head = diagHead(await (await fetch(IP + '/diag?from=4294967295')).text());
  ok('/diag header parses on the bench', !!head, JSON.stringify(head));
  const arm = await fetch(IP + '/ota/arm', { method: 'POST' });
  const armText = await arm.text();
  ok('POST /ota/arm answers 202 with an id and the window', arm.status === 202 && /^\{"id":"[0-9a-f]{8}","window_s":60\}$/.test(armText), arm.status + ' ' + armText);
  if (arm.status === 202) {
    const { id } = JSON.parse(armText);
    const st = await (await fetch(IP + '/ota/arm?id=' + id)).json();
    ok('GET /ota/arm?id= reads pending', st.state === 'pending', JSON.stringify(st));
    const again = await fetch(IP + '/ota/arm', { method: 'POST' });
    const againText = await again.text();
    ok('a second arm is refused in plain words', again.status === 409, again.status + ' ' + againText + ' -> ' + refusal(again.status, againText, 'arm'));
    const post = await fetch(IP + '/ota?id=' + id, { method: 'POST', body: new Uint8Array(0) });
    const postText = await post.text();
    ok('POST /ota with an unapproved id is 403', post.status === 403, post.status + ' ' + postText + ' -> ' + refusal(post.status, postText));
    const other = await (await fetch(IP + '/ota/arm?id=12345678')).json();
    ok('an unknown id reads expired', other.state === 'expired');
  }
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
