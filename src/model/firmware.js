/**
 * firmware.js -- the flasher's logic (DESIGN §10.19): the image checks, the
 * origin label, the machine's answers in plain words, the /diag verdict and
 * the flow itself.
 *
 * Constraints:
 * - No Tauri, no DOM: the flow takes its transport (`net`) and its state
 *   object, so test/flasher.test.mjs runs it under node and against a bench.
 * - The machine decides (Nucleus ValenceOta.h): nothing here refuses an
 *   update the machine would take, except an image that is not Nucleus P4
 *   firmware at all.
 * - The running slot is the evidence of a new image, never the version: a
 *   same-version reflash moves the slot.
 * - One flow at a time; every await re-checks its run so a cancel or a new
 *   pick ends the old one.
 */

export const CHIP_P4 = 0x0012;
export const PROJECT = 'flagship_p4';
export const RELEASES = 'https://api.github.com/repos/openvalence/Nucleus/releases';
export const DIAG_HEAD = '/diag?from=4294967295';   // the header and footer only (tools/ota.py)
export const VERDICT_WAIT_MS = 150000;
const CHIPS = { 0: 'ESP32', 2: 'ESP32-S2', 5: 'ESP32-C3', 9: 'ESP32-S3', 12: 'ESP32-C2', 13: 'ESP32-C6', 16: 'ESP32-H2', 18: 'ESP32-P4', 20: 'ESP32-C61', 23: 'ESP32-C5' };
const APP_DESC_MAGIC = 0xabcd5432;
// FIRMWARE_VERSION as tools/ota.py image_version() finds it; esp_app_desc's version is the git describe (val-1vdq).
const VERSION_RE = /\d+\.\d+\.\d+-p4hub[\w.-]*/g;

/** The image's facts, or {error} naming the fault and its one action. */
export function readImage(bytes) {
  if (bytes.length < 256 || bytes[0] !== 0xe9) return { error: 'Not a firmware image: pick a Nucleus .bin' };
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chip = dv.getUint16(12, true);
  if (chip !== CHIP_P4) return { error: 'Built for ' + (CHIPS[chip] || 'chip ' + chip) + ': pick a P4 image' };
  if (dv.getUint32(32, true) !== APP_DESC_MAGIC) return { error: 'No app description: pick a Nucleus .bin' };
  const str = (o, n) => new TextDecoder().decode(bytes.subarray(o, o + n)).replace(/\0[\s\S]*$/, '');
  const project = str(80, 32);
  if (project !== PROJECT) return { error: 'Not Nucleus firmware (' + project + '): pick a Nucleus .bin' };
  const found = new Set(new TextDecoder('latin1').decode(bytes).match(VERSION_RE));
  return { chip: CHIPS[chip], project, build: str(48, 32), date: str(128, 16), version: found.size === 1 ? [...found][0] : null };
}

export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** True when a sha256sum-format file lists `hash`. */
export function sumsHave(text, hash) {
  return text.split(/\r?\n/).some((l) => l.trim().split(/\s+/)[0]?.toLowerCase() === hash);
}

/** {kind: official|unrecognized|unknown, label}. Every kind may be flashed; the label informs. */
export async function originOf(hash, net) {
  const failed = { kind: 'unknown', label: "Can't check: GitHub didn't answer" };
  let releases;
  try {
    const r = await net.get(RELEASES);
    if (r.status !== 200) return failed;
    releases = JSON.parse(r.text);
  } catch (e) { return failed; }
  const sums = releases.flatMap((rel) => (rel.assets || []).filter((a) => a.name === 'SHA256SUMS')
    .map((a) => ({ tag: rel.tag_name, url: a.browser_download_url })));
  if (!sums.length) return { kind: 'unknown', label: "Can't check: no published checksums" };
  const texts = await Promise.all(sums.map((s) => net.get(s.url).then((r) => (r.status === 200 ? r.text : null), () => null)));
  const hit = texts.findIndex((t) => t && sumsHave(t, hash));
  if (hit >= 0) return { kind: 'official', label: 'Official ' + sums[hit].tag };
  return texts.some((t) => t != null) ? { kind: 'unrecognized', label: 'Unrecognized build' } : failed;
}

/** `/diag`'s first line: {version, slot, img, up} or null. */
export function diagHead(text) {
  const m = /^#\s+\S+\s+(\S+)\s.*\bslot=(\S+)\s.*\bimg=(\w+)\s.*\bup=(\d+)s/.exec((text || '').split('\n')[0]);
  return m ? { version: m[1], slot: m[2], img: m[3], up: +m[4] } : null;
}

/**
 * After the upload: done (new slot, bought), trial (new slot, not bought
 * yet), rollback (restarted onto the old slot), or null (no answer, or the
 * old boot still running). `sinceS` is the time since the 200.
 */
export function verdict(before, now, sinceS) {
  if (!now || now.up > sinceS + 2) return null;
  if (now.slot !== before.slot) return now.img === 'valid' ? 'done' : 'trial';
  return 'rollback';
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** A refusal in plain words with one action. `status` null: nothing answered. */
export function refusal(status, text, step) {
  const why = (text || '').trim().split('\n')[0];
  if (status == null) return 'No answer from the machine: check it is on this network';
  if (status === 404 && step === 'arm') return 'This machine takes no network updates';
  if (status === 403) return 'Not approved: press Update, then double-press PAIR';
  if (status === 409) {
    if (/already in flight/.test(why)) return 'Another update is running: wait for it to finish';
    if (/another update request/.test(why)) return 'Another request is open: try again in a minute';
    return cap(why || 'the machine is busy: stop it first');
  }
  if (status === 400) return 'The machine refused the image (' + why + '): pick another .bin';
  return 'The machine could not take it (' + (why || status) + '): restart it, try again';
}

export const blank = () => ({
  running: null,    // diagHead() of the machine, read by peek() and after an update
  phase: 'idle',    // idle | checking | ready | arming | waiting | uploading | restarting | done | failed
  file: null,       // {name, size}
  image: null,      // readImage()
  hash: '',
  origin: null,     // originOf()
  status: '',       // the one status line
  tone: '',         // '' | pending | settled | fault (pane.css .pane-status)
  sent: 0,
  total: 0,
});

/**
 * The flow over `state` (blank()'s shape). net: {get(url), post(url),
 * upload(host, id, bytes, onSent)}, each resolving {status, text} and
 * throwing when nothing answered; sleep(ms) and now() for tests.
 */
export function createFlasher(state, net, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  let run = 0;
  let bytes = null;
  const set = (o) => Object.assign(state, o);
  const say = (status, tone = '') => set({ status, tone });
  const fail = (status) => set({ phase: 'failed', status, tone: 'fault' });
  const ask = (fn, url) => fn(url).catch(() => ({ status: null, text: '' }));
  const diag = async (host) => diagHead((await ask(net.get, 'http://' + host + DIAG_HEAD)).text);

  async function pick(file) {
    const my = ++run;
    bytes = null;
    Object.assign(state, blank(), { running: state.running, phase: 'checking', file: { name: file.name, size: file.size } });
    const b = new Uint8Array(await file.arrayBuffer());
    const image = readImage(b);
    const hash = await sha256(b);
    if (my !== run) return;
    bytes = image.error ? null : b;
    set({ phase: image.error ? 'failed' : 'ready', image, hash, tone: image.error ? 'fault' : '', status: image.error || '' });
    if (image.error) return;
    state.origin = { kind: 'checking', label: 'Checking' };
    const origin = await originOf(hash, net);
    if (my === run) state.origin = origin;
  }

  async function update(host) {
    if (!bytes || !host) return;
    const my = ++run;
    const live = () => my === run;
    set({ phase: 'arming', sent: 0, total: bytes.length });
    say('Asking the machine', 'pending');
    const before = await diag(host);
    if (!live()) return;
    if (!before) return fail(refusal(null));
    state.running = before;
    const arm = await ask(net.post, 'http://' + host + '/ota/arm');
    if (!live()) return;
    if (arm.status !== 202) return fail(refusal(arm.status, arm.text, 'arm'));
    const { id, window_s: windowS } = JSON.parse(arm.text);
    const end = now() + windowS * 1000;
    set({ phase: 'waiting' });
    for (;;) {
      say('Double-press PAIR on the machine · ' + Math.max(0, Math.ceil((end - now()) / 1000)) + ' s', 'pending');
      await sleep(1000);
      if (!live()) return;
      const st = await ask(net.get, 'http://' + host + '/ota/arm?id=' + id);
      if (!live()) return;
      const answer = st.status === 200 ? JSON.parse(st.text).state : null;
      if (answer === 'approved') break;
      if (answer === 'expired' || now() > end + 5000) return fail('The window closed: try again');
    }
    set({ phase: 'uploading' });
    say('Sending', 'pending');
    let up;
    try {
      up = await net.upload(host, id, bytes, (sent) => { if (live()) state.sent = sent; });
    } catch (e) {
      up = null;
    }
    if (!live()) return;
    if (!up) return fail('The upload broke off: the machine keeps its firmware, try again');
    if (up.status !== 200) return fail(refusal(up.status, up.text, 'upload'));
    set({ phase: 'restarting', sent: bytes.length });
    const t0 = now();
    let last = null;
    while (now() - t0 < VERDICT_WAIT_MS) {
      say('Restarting · ' + Math.round((now() - t0) / 1000) + ' s', 'pending');
      await sleep(2000);
      if (!live()) return;
      const head = await diag(host);
      if (!live()) return;
      const v = verdict(before, head, (now() - t0) / 1000);
      if (v) state.running = head;
      if (v === 'done') return set({ phase: 'done', status: 'Updated to ' + head.version, tone: 'settled' });
      if (v === 'rollback') return fail('The new firmware failed to start: back on ' + head.version);
      if (v === 'trial') { last = head; say('Confirming ' + head.version, 'pending'); }
    }
    fail(last ? 'Still confirming ' + last.version + ': it reverts by itself if it fails'
      : 'No answer after restart: check its power and Wi-Fi');
  }

  /** Reads what the machine runs, unless a flow is talking to it. */
  async function peek(host) {
    if (busy()) return;
    const head = await diag(host);
    if (head && !busy()) state.running = head;
  }

  const busy = () => ['checking', 'arming', 'waiting', 'uploading', 'restarting'].includes(state.phase);

  /** Ends a wait; the machine drops the request when its window closes. */
  function cancel() {
    run++;
    set({ phase: bytes ? 'ready' : 'idle', status: 'Cancelled', tone: '', sent: 0 });
  }

  return { pick, update, cancel, peek, busy };
}
