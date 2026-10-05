/**
 * responsive-matrix.mjs -- does every view hold up at every screen size?
 *
 * Renders the FULL app with no hub: Playwright's WebSocket route stands in for
 * the hub on :82, the recorded valencesim catalog is pre-seeded into the
 * client's etag cache (the warm-reconnect path, zero BLOB frames), and a
 * synthetic STATE stream feeds every subscribed channel from the catalog's own
 * layouts (defaults, else mid-bounds). The values are FIXTURE values, never
 * shown as a real machine: this is a layout instrument only. Uses the
 * FIXTURE, never a running valencesim, so it needs no sim and no hardware;
 * point the built page at `/?hub=127.0.0.1` with valencesim up for real STATE.
 *
 * Per viewport it visits every nav tab, screenshots it to
 * test/evidence/responsive/<view>-<w>x<h>[@2x][-<tile>].png (scrolled tiles on
 * a page that scrolls) and asserts:
 *   overflow   no horizontal page scroll
 *   target     interactive hit boxes >= 40x40 CSS px on phones (T24: the
 *              rendered box; a range input is measured by its thumb, a hidden
 *              switch input by its label)
 *   clip       no leaf text clipped by its own overflow box
 *   sticky     phone: tab strip parks flush under the top strip (T22)
 *   strip      one e-stop, inside the top strip, on screen with every scroll
 *              container scrolled to its end (law 11); nothing but the
 *              page footer fixed to the bottom edge, and that footer one
 *              whole 48 px bar; .app spans the window (DESIGN §10.3, §10.4)
 *   chrome     no two fixed/sticky bars overlap
 *   reach      phone: every control can be scrolled clear of fixed chrome
 *   font       no text below 11px
 *   measure    no prose line past ~100 characters; no chart under 24px tall
 *
 * After the matrix, scenario checks (ph-vdk.13, ph-vdk.5, ph-vdk.38):
 *   picker   file:// and a refused hub render the hub picker, not a blank
 *            page; a dropped link shows its state and re-adopts the hub
 *   glance   no pointer selects glance at 1280: a vertical category menu, a
 *            subgroup screen replaces it, the page passes the layout checks
 *   class    a renderer-class switch keeps the active tab and a write in
 *            flight, and waits for a held pointer (RFC-062 draft)
 *   scale    no horizontal page scroll at any scale step; the target floor
 *            holds at the smallest scale on phones (ph-e82.3, law 12)
 *   home     full: the home in edit mode with every palette section open
 *            passes the layout and strip checks (ph-e82.5); the grid toolbar
 *            holds one row at 1280, its menu opens on screen, and a phone in
 *            edit mode has no horizontal scroll; layout handles stay 40 CSS
 *            px at the smallest scale (ph-e82.15)
 *   builder  1280 and 360: a category page in edit mode under a compact
 *            layout, with a nest holding a member (stored with the fold flag
 *            an older build wrote, inert now), an empty nest and a card
 *            selected (selection bar), passes the layout and strip checks
 *            (ph-e82.20, ph-e82.22)
 *   nest     phone: a nest is not a scroll region of its own, a wheel over
 *            it scrolls the page, the page passes the layout checks
 *            (ph-e82.6)
 *   phosphor the served page with a hub has no Phosphor group; the shell
 *            bundle (shell-build.mjs) carries it, and every Phosphor pane
 *            passes the layout and strip checks at desktop, landscape phone
 *            and phone (ph-e82.16)
 *
 * Build first (`npm run build:only`); this builds nothing but the phosphor
 * scenario's shell bundle.
 * Run: node test/responsive-matrix.mjs [--only 360x800|picker|bucket|class|glance|home|scale|nest|builder|phosphor] [--no-shots]
 *        [--html <other build's index.html> --out <dir>]   (A/B a build)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { cbMap, cbUint, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, PACKED, LIMITS } from '../../Valence/clients/js/frames.js';
import { SCALE_STEPS, SCALE_KEY, STORE_KEY } from '../src/model/grid.js';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';

const args = process.argv.slice(2);
const argOf = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const ONLY = argOf('--only', null);
const SHOTS = !args.includes('--no-shots');

const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT = argOf('--out', null) || join(HERE, 'evidence', 'responsive');
mkdirSync(OUT, { recursive: true });

const HTML = readFileSync(argOf('--html', null) || new URL('../dist/index.html', import.meta.url));
const CAT = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
const ETAG = readFileSync(new URL('./fixtures/valencesim-catalog.etag', import.meta.url), 'utf8').trim();
const ENTRIES = decodeCatalog(CAT);
const toHex = (b) => Buffer.from(b).toString('hex');

// ---- HTTP: the bundle, plus a /uitoken mint so the session is control tier --
const TOKEN = JSON.stringify({ ok: true, token: '5a'.repeat(LIMITS.token_bytes) });
const srv = createServer((q, s) => {
  if (q.url.startsWith('/uitoken')) { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end(TOKEN); return; }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(HTML);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

// ---- synthetic STATE ------------------------------------------------------
const OVERRIDE = {
  window_min: 10, window_max: 140, max_rail: 150, measured_stroke: 150,
  enabled_mask: 0xff, heap_free: 124000, uptime_s: 3725, rssi: -58, sessions: 1,
  owner_session: 1, flags: 0, word: 0, count: 0, capacity: 8, generation: 1,
};
function fieldValue(f, t) {
  if (f.name === 'pos_10um' || f.name === 'raw_10um') return 75 + 50 * Math.sin(t / 900);
  if (f.name === 'tgt_10um') return 75 + 50 * Math.sin((t + 120) / 900);
  if (f.name === 'speed') return 180 * Math.cos(t / 900);
  if (f.name === 'flags' && f.bits && f.bits.includes('homed')) return 1;   // homed
  // ph-0pw: all four slots report src 0 -- a zeroed control-owner snapshot is
  // legal on the wire, and PairingPane's owners list must not crash on the
  // duplicate key (it keys by slot index, never by src).
  if (/^src\d$/.test(f.name)) return 0;
  if (f.name === 'cur_norm') return 0.5 + 0.4 * Math.sin(t / 700);
  if (f.name in OVERRIDE) return OVERRIDE[f.name];
  if (f.default != null) return f.default;
  if (f.min != null && f.max != null) return f.min + (f.max - f.min) * 0.4;
  return 0;
}
const SIZE = { [PACKED.u8]: 1, [PACKED.i8]: 1, [PACKED.u16]: 2, [PACKED.i16]: 2, [PACKED.u32]: 4,
  [PACKED.i32]: 4, [PACKED.f32]: 4, [PACKED.bitfield8]: 1, [PACKED.str16]: 16, [PACKED.str32]: 32, [PACKED.str64]: 64 };
function encodePacked(layout, t) {
  const n = layout.reduce((a, f) => a + (SIZE[f.type] ?? f.declaredSize ?? 0), 0);
  const out = new Uint8Array(n);
  const dv = new DataView(out.buffer);
  let off = 0;
  for (const f of layout) {
    const sz = SIZE[f.type] ?? f.declaredSize ?? 0;
    const v = fieldValue(f, t);
    const raw = f.type === PACKED.f32 || f.type === PACKED.bitfield8 ? v : Math.round(v * (f.scale || 1));
    const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
    switch (f.type) {
      case PACKED.u8: case PACKED.bitfield8: dv.setUint8(off, clamp(raw, 0, 255)); break;
      case PACKED.i8: dv.setInt8(off, clamp(raw, -128, 127)); break;
      case PACKED.u16: dv.setUint16(off, clamp(raw, 0, 65535), true); break;
      case PACKED.i16: dv.setInt16(off, clamp(raw, -32768, 32767), true); break;
      case PACKED.u32: dv.setUint32(off, clamp(raw, 0, 4294967295), true); break;
      case PACKED.i32: dv.setInt32(off, raw | 0, true); break;
      case PACKED.f32: dv.setFloat32(off, v, true); break;
      default: break;   // strings stay zero-padded empty
    }
    off += sz;
  }
  return out;
}

// ---- the fake hub ---------------------------------------------------------
const LOG_LINES = [
  [2, 'sys', 'boot complete, fixture hub (responsive matrix)'],
  [3, 'kinetic', 'waveform segment reshaped to hold its deadline: amplitude budget floor reached at 0.62 of the requested stroke, which is a deliberately long line to test wrapping'],
  [4, 'link', 'SUBSCRIBE_REJECTED would look like this if the batching regressed'],
];
function logEvent(lvl, tag, msg, ms) {
  return cbMap([[K.event_kind, cbUint(0)], [K.body, cbMap([[1, cbUint(lvl)], [2, cbTstr(tag)], [3, cbUint(ms)], [4, cbTstr(msg)]])]]);
}
// A latched-then-cleared e-stop on safety-events, so the dock's edge line is
// on screen at every size.
function safetyEdge(kind, word) {
  return cbMap([[K.event_kind, cbUint(kind)], [K.body, cbMap([[1, cbUint(word)], [2, cbUint(1)], [3, cbUint(7)], [4, cbUint(1)]])]]);
}
function fakeHub(ws, hubName = 'Responsive fixture') {
  const subs = new Set();
  let timer = null;
  const t0 = Date.now();
  const send = (type, ch, payload) => { try { ws.send(Buffer.from(encodeFrame(type, ch, payload))); } catch (e) { /* closed */ } };
  const pushState = (id) => {
    const e = ENTRIES.find((x) => x.id === id);
    if (e && e.layout) send(FRAME.STATE, id, encodePacked(e.layout, Date.now() - t0));
  };
  ws.onMessage((msg) => {
    if (typeof msg === 'string') return;
    for (const { header, payload } of parseFrames(new Uint8Array(msg))) {
      if (header.type === FRAME.HELLO) {
        send(FRAME.WELCOME, 0, cbMap([
          [K.session_id, cbUint(7)], [K.boot_id, cbUint(0x5eed)],
          [K.catalog_etag, cbBstr(Uint8Array.from(Buffer.from(ETAG, 'hex')))], [K.cfg_gen, cbUint(1)],
          [K.limits, cbMap([[WELCOME_LIMITS_K.max_frame, cbUint(4096)], [WELCOME_LIMITS_K.max_subscriptions, cbUint(64)],
            [WELCOME_LIMITS_K.max_subscriptions_per_frame, cbUint(16)]])],
          [K.roles, cbUint(2)], [K.deadman_ms, cbUint(600000)],
          [K.identity, cbMap([[IDENTITY_K.product, cbTstr('fixture')], [IDENTITY_K.fw_version, cbTstr('0.0.0-fixture')],
            [IDENTITY_K.hub_name, cbTstr(hubName)]])],
        ]));
      } else if (header.type === FRAME.SUBSCRIBE) {
        const m = cbDecodeFull(payload);
        const grants = [];
        for (const w of m.get(K.subscriptions) || []) {
          const ch = w.get(K.channel_id);
          subs.add(ch);
          grants.push(cbMap([[K.priority, cbUint(w.get(K.priority) || 0)], [K.granted_rate_hz, cbUint(w.get(K.rate_hz) || 0)],
            [K.channel_id, cbUint(ch)]]));
          pushState(ch);
          if (ch === 0x8) LOG_LINES.forEach(([l, tg, s], i) => send(FRAME.EVENT, 0x8, logEvent(l, tg, s, 1000 + i)));
          if (ch === 0xe) [[1, 1], [2, 0]].forEach(([k, wd]) => send(FRAME.EVENT, 0xe, safetyEdge(k, wd)));
        }
        send(FRAME.GRANT, 0, cbMap([[K.grants, cbArray(grants)]]));
        if (!timer) timer = setInterval(() => { for (const id of [0x1100, 0x1110]) if (subs.has(id)) pushState(id); }, 40);
      } else if (header.type === FRAME.PING) {
        send(FRAME.PONG, header.channel, payload);
      }
    }
  });
  ws.onClose(() => clearInterval(timer));
}

// ---- in-page measurement --------------------------------------------------
// `coarse` gates the tap-target/reach checks (pointer: coarse, any width: a
// touch tablet at 960px+ is coarse but not phone); `phone` still gates the
// page-scroll-specific sticky check. Defaults to `phone` for callers that
// have not been updated to distinguish the two (scenario checks).
function measure({ phone, coarse = phone }) {
  const fails = [];
  const vw = window.innerWidth, vh = window.innerHeight;
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    // A closed <details> keeps a box for its content but never shows it.
    if (el.closest('details:not([open]) > :not(summary)')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const name = (el) => {
    const c = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).filter((x) => !x.startsWith('svelte-')).join('.') : '';
    const t = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    return el.tagName.toLowerCase() + c + (t ? ' "' + t + '"' : '');
  };

  // overflow
  const sw = document.scrollingElement.scrollWidth;
  if (sw > vw + 0.5) {
    // Culprit = sticks out past the viewport while its parent does not, and
    // no ancestor clips or scrolls it (those never widen the page).
    const culprits = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right <= vw + 0.5 || !vis(el)) continue;
      if (el.parentElement.getBoundingClientRect().right > vw + 0.5) continue;
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).overflowX !== 'visible') { clipped = true; break; }
      }
      if (!clipped) culprits.push(name(el) + ' right=' + Math.round(r.right));
    }
    fails.push(['overflow', 'scrollWidth ' + sw + ' > ' + vw + (culprits.length ? ': ' + culprits.slice(0, 3).join('; ') : '')]);
  }

  // font floor
  const small = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.data.trim()) continue;
    const el = n.parentElement;
    if (!el || !vis(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 10.95) { const k = name(el).split(' "')[0] + ' ' + fs.toFixed(1) + 'px'; small.set(k, (small.get(k) || 0) + 1); }
  }
  for (const [k, c] of small) fails.push(['font', k + (c > 1 ? ' x' + c : '')]);

  // clipped text
  for (const el of document.querySelectorAll('body *')) {
    if (![...el.childNodes].some((c) => c.nodeType === 3 && c.data.trim())) continue;
    if (!vis(el) || el.clientWidth <= 2) continue;   // visually-hidden (sr-only) text is meant to be clipped
    const cs = getComputedStyle(el);
    if (!/(hidden|clip)/.test(cs.overflowX) && cs.textOverflow !== 'ellipsis') continue;
    // Fixed-height chrome (ph-e82.17) ellipsizes on purpose; its full form
    // must then be one hover away, in its own or an ancestor's title.
    const full = el.closest('[title]')?.title || '';
    if (full.includes(el.textContent.trim())) continue;
    if (el.scrollWidth > el.clientWidth + 1) fails.push(['clip', name(el) + ' ' + el.scrollWidth + '>' + el.clientWidth]);
  }

  // prose measure + chart height
  for (const el of document.querySelectorAll('p, .field-desc, .explain, li')) {
    if (!vis(el) || el.textContent.trim().length < 100) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    const chars = el.clientWidth / (fs * 0.5);
    if (chars > 105) fails.push(['measure', name(el) + ' ~' + Math.round(chars) + ' chars/line']);
  }
  for (const el of document.querySelectorAll('canvas, svg')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width >= 200 && r.height < 24 && !el.closest('button, .ico, .tbtn, .btn')) fails.push(['measure', 'chart ' + name(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)]);
  }

  // fixed/sticky chrome overlap
  const chrome = [...document.querySelectorAll('body *')].filter((el) => {
    const p = getComputedStyle(el).position;
    return (p === 'fixed' || p === 'sticky') && vis(el) && getComputedStyle(el).pointerEvents !== 'none' && !el.parentElement.closest('[style*="fixed"], .topstrip, nav.tabs');
  });
  for (let i = 0; i < chrome.length; i++) for (let j = i + 1; j < chrome.length; j++) {
    const a = chrome[i].getBoundingClientRect(), b = chrome[j].getBoundingClientRect();
    if (chrome[i].contains(chrome[j]) || chrome[j].contains(chrome[i])) continue;
    const ov = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    const oh = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    if (ov > 1 && oh > 1) fails.push(['chrome', name(chrome[i]) + ' overlaps ' + name(chrome[j]) + ' by ' + Math.round(ov) + 'px']);
  }

  const INTERACTIVE = 'button, a[href], input:not([type=hidden]), select, textarea, [role=tab], [role=button], [role=slider], [role=switch], summary';
  const controls = [...document.querySelectorAll(INTERACTIVE)].filter((el) => {
    if (el.matches('input') && getComputedStyle(el).opacity === '0') return !!el.closest('label') && vis(el.closest('label'));
    return vis(el);
  });

  // targets + reach (any coarse pointer, not only phones). A hit box is what
  // a finger actually lands on (T24): after scrolling the control clear,
  // probe 19.5px out from its center in all four directions with
  // elementFromPoint, so a pseudo-element hit extension counts and a
  // neighbor stealing the edge does not. Controls in fixed chrome are not
  // scrolled; their rendered box is the measure.
  if (coarse) {
    const seen = new Map();
    const blocked = new Map();
    const owns = (box, hit) => hit && (box.contains(hit) || (hit.control && box.contains(hit.control)) || hit.contains(box) && hit.matches('label'));
    for (const el of controls) {
      const box = el.matches('input') && getComputedStyle(el).opacity === '0' ? el.closest('label') : el;
      const inChrome = chrome.some((f) => f.contains(box));
      if (!inChrome) box.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = box.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let ok = r.width >= 39.5 && r.height >= 39.5;
      if (!ok && !inChrome) {
        ok = [[-19.5, 0], [19.5, 0], [0, -19.5], [0, 19.5]].every(([dx, dy]) =>
          owns(box, document.elementFromPoint(Math.min(vw - 1, Math.max(0, cx + dx)), Math.min(vh - 1, Math.max(0, cy + dy)))));
      }
      const k = name(box).split(' "')[0];
      if (!ok) {
        const s = seen.get(k) || { n: 0, ex: name(box) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) };
        s.n++; seen.set(k, s);
      }
      if (inChrome) continue;
      const hit = document.elementFromPoint(Math.min(vw - 1, Math.max(0, cx)), Math.min(vh - 1, Math.max(0, cy)));
      const cover = hit && !owns(box, hit) && chrome.find((f) => f.contains(hit));
      if (cover && !blocked.has(k)) blocked.set(k, name(box) + ' under ' + name(cover).split(' "')[0]);
    }
    for (const [, s] of seen) fails.push(['target', s.ex + (s.n > 1 ? ' (x' + s.n + ')' : '')]);
    for (const [, v] of blocked) fails.push(['reach', v]);
    window.scrollTo(0, 0);
    document.querySelectorAll('.content').forEach((c) => { c.scrollTop = 0; });
  }
  return fails;
}

function stripCheck() {
  const out = [];
  const own = document.querySelectorAll('.topstrip .btn-estop');
  if (own.length !== 1) out.push(['strip', own.length + ' e-stop(s) in the top strip']);
  window.scrollTo(0, document.scrollingElement.scrollHeight);
  document.querySelectorAll('*').forEach((el) => { if (el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight; });
  const r = own[0] && own[0].getBoundingClientRect();
  if (r && !(r.width > 0 && r.top >= -0.5 && r.left >= -0.5 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5)) {
    out.push(['strip', 'e-stop off screen when scrolled to the end: ' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(',')]);
  }
  // ph-e82.21: the e-stop is the outermost strip control, Pause beside it.
  const ctl = [...document.querySelectorAll('.strip button')].filter((b) => b.getBoundingClientRect().width > 0 && !b.closest('.status, .menu-pop'));
  const pause = document.querySelector('.topstrip .btn-pause');
  if (r && (ctl.some((b) => b.getBoundingClientRect().right > r.right + 0.5)
    || !pause || pause.getBoundingClientRect().right > r.left + 0.5)) out.push(['strip', 'the e-stop is not the outermost control']);
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    // The page footer is the one bar ruled onto the bottom edge (DESIGN §10.3).
    if (cs.position !== 'fixed' || cs.pointerEvents === 'none' || cs.display === 'none' || el.matches('.page-foot')) continue;
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.height > 0 && b.bottom >= innerHeight - 1) out.push(['strip', 'fixed bar at the bottom edge: ' + el.className]);
  }
  // ph-vdk.60.12: the page footer is whole at every size, scrolled to the
  // end as at the top: one 48 px row where its controls fit beside the
  // scale, more rows where they do not (ph-dj9), never a scroller.
  const foot = document.querySelector('main.pane .page-foot');
  const fb = foot && foot.getBoundingClientRect();
  if (fb && fb.height > 0 && !(fb.height >= 47.5 && fb.top >= -0.5 && fb.bottom <= innerHeight + 0.5 && fb.left >= -0.5 && fb.right <= innerWidth + 0.5)) {
    out.push(['strip', 'page footer ' + [fb.left, fb.top, fb.width, fb.height].map(Math.round).join(',') + ' scrolled to the end']);
  }
  if (foot && [foot, ...foot.querySelectorAll('*')].some((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowX))) {
    out.push(['strip', 'page footer scrolls sideways']);
  }
  const app = document.querySelector('.app').getBoundingClientRect();
  if (Math.abs(app.width - document.documentElement.clientWidth) > 1) out.push(['strip', '.app ' + Math.round(app.width) + 'px wide in a ' + document.documentElement.clientWidth + 'px window']);
  window.scrollTo(0, 0);
  document.querySelectorAll('*').forEach((el) => { el.scrollTop = 0; });
  return out;
}

function stickyCheck() {
  const lb = document.querySelector('.topstrip');
  const tabs = document.querySelector('nav.tabs');
  if (!lb || !tabs || getComputedStyle(tabs).position !== 'sticky') return [];
  window.scrollTo(0, 0);
  const tabsDocTop = tabs.getBoundingClientRect().top;
  window.scrollTo(0, 4000);
  const a = lb.getBoundingClientRect(), b = tabs.getBoundingClientRect();
  const stuck = document.scrollingElement.scrollTop >= tabsDocTop - a.height;
  const out = [];
  if (Math.abs(a.top) > 1) out.push(['sticky', 'top strip top=' + a.top.toFixed(1) + ' when scrolled']);
  if (b.top < a.bottom - 1) out.push(['sticky', 'tabs slide under the top strip: top=' + b.top.toFixed(1) + ' vs ' + a.bottom.toFixed(1)]);
  else if (stuck && Math.abs(b.top - a.bottom) > 1) out.push(['sticky', 'tabs top=' + b.top.toFixed(1) + ' vs top strip bottom=' + a.bottom.toFixed(1)]);
  window.scrollTo(0, 0);
  return out;
}

// ---- the matrix -----------------------------------------------------------
// --vp 1428x900,420x860 replaces the list (evidence shots at chosen sizes).
const VP = argOf('--vp', null)?.split(',').map((v) => v.split('x').map(Number));
const VIEWPORTS = VP || [
  [200, 390], [320, 568], [360, 800], [390, 844, 2], [412, 915], [844, 390], [768, 1024], [1024, 768],
  [1280, 720], [1440, 900, 2], [1920, 1080], [2560, 1440], [3840, 2160],
];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const browser = await chromium.launch();
const table = [];
let total = 0;
const pageErrors = [];

// One pass over one viewport/pointer combination. `coarse` (independent of
// viewport size) drives Playwright's touch emulation, so a >=960px "touch
// tablet" pass -- the case that has no phone-sized surrogate -- gets a real
// (pointer: coarse) media match rather than being inferred from width.
// Screenshots are taken only on the canonical (non-extra) pass: the coarse
// re-visit exists to run the target check, not to double the evidence dir.
async function visitViewport(w, h, dpr, tag, phone, coarse, takeShots) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: coarse, isMobile: false });
  await ctx.addInitScript(([etag, bytes]) => {
    try {
      if (!sessionStorage.getItem('rm.seeded')) {
        localStorage.clear();
        localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes }));
        sessionStorage.setItem('rm.seeded', '1');
      }
    } catch (e) { /* no storage: the harness will report a missing catalog */ }
  }, [ETAG, toHex(CAT)]);
  await ctx.routeWebSocket(/:82\//, fakeHub);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(tag + ': ' + e));
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
  const tabSel = w >= 960 ? 'nav.rail [role=tab]' : 'nav.tabs [role=tab]';
  const up = await page.waitForSelector(tabSel, { timeout: 15000 }).then(() => true).catch(() => false);
  if (!up) { table.push([tag, '-', 'boot', 'no nav tabs rendered (catalog not adopted?)']); total++; await ctx.close(); return; }
  await page.waitForTimeout(600);
  const labels = await page.$$eval(tabSel, (els) => els.map((e) => e.getAttribute('title') || e.textContent.trim()));
  for (let i = 0; i < labels.length; i++) {
    const view = slug(labels[i]);
    await page.locator(tabSel).nth(i).click();
    await page.waitForTimeout(350);
    const fails = [...await page.evaluate(measure, { phone, coarse }), ...await page.evaluate(stripCheck),
      ...(phone || w < 960 ? await page.evaluate(stickyCheck) : [])];
    if (takeShots) {
      await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('.content').forEach((c) => { c.scrollTop = 0; }); });
      // Tiles, not fullPage: a fullPage capture resizes the viewport and
      // Chromium drops touch emulation (pointer: coarse) for the rest of
      // the session, so every later measurement would be a mouse layout.
      const docH = await page.evaluate(() => document.scrollingElement.scrollHeight);
      for (let t = 0, y = 0; t < 6 && (t === 0 || y < docH - h / 3); t++, y += Math.round(h * 0.8)) {
        await page.evaluate((y) => window.scrollTo(0, y), y);
        await page.screenshot({ path: join(OUT, view + '-' + tag + (t ? '-' + (t + 1) : '') + '.png') });
      }
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    for (const [k, d] of fails) { table.push([tag, view, k, d]); total++; }
  }
  await ctx.close();
}

for (const [w, h, dpr2] of VIEWPORTS) {
  for (const dpr of dpr2 ? [1, 2] : [1]) {
    const tag = w + 'x' + h + (dpr === 2 ? '@2x' : '');
    if (ONLY && !tag.startsWith(ONLY)) continue;
    const phone = Math.min(w, h) < 600;
    await visitViewport(w, h, dpr, tag, phone, phone, SHOTS);
    // Phone-sized viewports are already a coarse-pointer pass. Everything
    // wider (tablet, desktop) also needs one: a >=960px touch tablet is the
    // gap ph-vdk.8 named, and the mouse-only pass above never exercises it.
    if (!phone) await visitViewport(w, h, dpr, tag + '+coarse', phone, true, false);
  }
}
// ---- scenarios: first run, reconnect, class switch ---------------------------
const scen = (name, cond, extra) => {
  if (!cond) { table.push(['scenario', name, 'fail', extra || '']); total++; }
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  -- ' + extra : ''));
};
async function seeded(viewport, route) {
  const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 600 });
  await ctx.addInitScript(([etag, bytes]) => {
    try { localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes })); } catch (e) { /* none */ }
  }, [ETAG, toHex(CAT)]);
  if (route) await ctx.routeWebSocket(/:82\//, route);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push('scenario: ' + e));
  return { ctx, page };
}

if (!ONLY || ONLY === 'picker') {
  console.log('\npicker scenarios');
  // file://: no hostname, no ?hub, nothing remembered.
  const htmlArg = argOf('--html', null);
  const fileUrl = htmlArg ? pathToFileURL(resolve(htmlArg)).href : new URL('../dist/index.html', import.meta.url).href;
  for (const vp of [{ width: 360, height: 800 }, { width: 1280, height: 720 }]) {
    const { ctx, page } = await seeded(vp, null);
    await page.goto(fileUrl);
    const shown = await page.waitForSelector('.picker input[aria-label="Hub address"]', { timeout: 8000 }).then(() => true).catch(() => false);
    const text = shown ? await page.textContent('.picker') : '';
    scen('file:// ' + vp.width + 'px renders the picker', shown && text.includes('No hub chosen') && text.includes('?hub='));
    const f = shown ? await page.evaluate(measure, { phone: vp.width < 600 }) : [];
    scen('file:// ' + vp.width + 'px picker passes the layout checks', f.length === 0, f.map((x) => x.join(' ')).join('; '));
    await ctx.close();
  }

  // A hub that refuses every session: retrying with a countdown, and Retry now.
  let opens = 0;
  {
    const { ctx, page } = await seeded({ width: 360, height: 800 }, (ws) => { opens++; ws.close({ code: 1011, reason: 'refused' }); });
    await page.goto('http://127.0.0.1:' + PORT + '/');
    const st = await page.waitForSelector('.picker .pk-status[data-phase=retrying]', { timeout: 8000 }).catch(() => null);
    const txt = st ? await st.textContent() : '';
    scen('a refused hub shows the picker with its retry state', !!st && /Retrying/.test(txt), txt.trim());
    const before = opens;
    await page.click('.picker button:has-text("Retry now")').catch(() => {});
    await page.waitForTimeout(400);
    scen('Retry now opens a session without waiting out the backoff', opens > before, before + ' -> ' + opens);
    const f = await page.evaluate(measure, { phone: true });
    scen('refused-hub picker passes the phone layout checks', f.length === 0, f.map((x) => x.join(' ')).join('; '));
    await ctx.close();
  }

  // A hub that drops the link and comes back rebooted: the page shows the
  // drop, keeps its last values, and adopts the new session's identity.
  {
    let n = 0;
    const { ctx, page } = await seeded({ width: 1280, height: 800 }, (ws) => {
      n++;
      fakeHub(ws, n === 1 ? 'Responsive fixture' : 'Rebooted fixture');
      if (n === 1) setTimeout(() => ws.close({ code: 1011, reason: 'reboot' }), 1500);
    });
    await page.goto('http://127.0.0.1:' + PORT + '/');
    // The strip's status slot carries the drop and Retry (ph-e82.17).
    const DROP = '.topstrip .status[data-kind=fault] button:has-text("Retry")';
    const line = await page.waitForSelector(DROP, { timeout: 8000 }).catch(() => null);
    const railKept = !!(await page.$('nav.rail'));
    scen('a dropped link is announced, and the page stays', !!line && railKept);
    const back = await page.waitForSelector(DROP, { state: 'detached', timeout: 8000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(300);
    const lb = await page.textContent('.linkbar');
    scen('the reconnect adopts the rebooted hub', back && lb.includes('Rebooted fixture') && !lb.includes('Responsive fixture'));
    await ctx.close();
  }
}

if (!ONLY || ONLY === 'bucket') {
  console.log('\nbucket scenarios');
  const { ctx, page } = await seeded({ width: 1428, height: 900 }, (ws) => fakeHub(ws));
  await page.goto('http://127.0.0.1:' + PORT + '/');
  await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 });
  const read = () => page.evaluate(() => ({ b: document.documentElement.dataset.bucket, c: getComputedStyle(document.documentElement).getPropertyValue('--cols').trim() }));
  for (const [w, h, want] of [[200, 390, '1'], [390, 844, '2'], [844, 390, '3'], [1428, 900, '4'], [2560, 1440, '5']]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(200);
    const r = await read();
    scen(w + 'x' + h + ' is bucket ' + want, r.b === want && Number(r.c) > 0, r.b + ' cols ' + r.c);
  }
  await page.setViewportSize({ width: 1428, height: 900 });
  // Ctrl+= through ScaleControl (the real path): 10 % steps stop at 140 % (knob max 1.6).
  for (let k = 0; k < 6; k++) await page.keyboard.press('Control+='); await page.waitForTimeout(200);
  scen('140 % UI scale puts 1428 in bucket 3', (await read()).b === '3', JSON.stringify(await read()));
  await ctx.close();
}

if (!ONLY || ONLY === 'class') {
  console.log('\nclass-switch scenarios');
  const { ctx, page } = await seeded({ width: 1280, height: 800 }, (ws) => fakeHub(ws));
  await page.goto('http://127.0.0.1:' + PORT + '/');
  await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 });
  await page.waitForTimeout(500);
  // A category tab with a range control (the write under test).
  const railTabs = page.locator('nav.rail [role=tab]');
  let label = '';
  for (let i = 1; i < await railTabs.count(); i++) {
    await railTabs.nth(i).click();
    await page.waitForTimeout(250);
    if (await page.$('.content input[type=range]:not(:disabled)')) { label = (await railTabs.nth(i).getAttribute('title')) || ''; break; }
  }
  scen('found a category with a range control', !!label, label);
  const inFlight = () => page.$$eval('[data-shadow]', (els) => els.filter((e) => e.getAttribute('data-shadow') !== 'confirmed').length);
  const base = await inFlight();
  const range = '.content input[type=range]:not(:disabled)';
  await page.focus(range);
  // A range at its max does not move on ArrowRight: step away from the end it sits at.
  await page.keyboard.press(await page.$eval(range, (el) => Number(el.value) >= Number(el.max)) ? 'ArrowLeft' : 'ArrowRight');
  await page.waitForTimeout(100);
  const pre = await inFlight();
  await page.setViewportSize({ width: 400, height: 800 });
  await page.waitForTimeout(300);
  const tabNow = await page.$eval('nav.tabs [aria-selected=true]', (e) => e.textContent.trim()).catch(() => '');
  scen('full -> handheld keeps the active category', tabNow === label, tabNow + ' vs ' + label);
  const post = await inFlight();
  scen('a write in flight is still shown after the switch', pre > base && post > base, base + ' -> ' + pre + ' -> ' + post);

  // RFC-062 item 5: no switch while a pointer is down.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForSelector('nav.rail', { timeout: 3000 });
  await page.mouse.move(600, 400);
  await page.mouse.down();
  await page.setViewportSize({ width: 400, height: 800 });
  await page.waitForTimeout(300);
  const held = !!(await page.$('nav.rail'));
  await page.mouse.up();
  await page.waitForTimeout(300);
  const released = !!(await page.$('nav.tabs'));
  scen('a class switch waits for the pointer to lift', held && released);
  const railTab = await page.$eval('nav.tabs [aria-selected=true]', (e) => e.textContent.trim()).catch(() => '');
  scen('the round trip still lands on the same category', railTab === label, railTab);
  await ctx.close();

  // §11 handheld drill-in: a promoted group opens its own page, which holds
  // the same layout floor as every other view.
  const phone = await seeded({ width: 390, height: 844 }, (ws) => fakeHub(ws));
  await phone.page.goto('http://127.0.0.1:' + PORT + '/');
  await phone.page.waitForSelector('nav.tabs [role=tab]', { timeout: 15000 });
  const tabs = phone.page.locator('nav.tabs [role=tab]');
  let opened = false;
  for (let i = 1; i < await tabs.count() && !opened; i++) {
    await tabs.nth(i).click();
    await phone.page.waitForTimeout(250);
    // The fixture's one group past eight controls is diagnostic-rank.
    await phone.page.click('.adv-toggle[aria-expanded=false]:has-text("diagnostic")', { timeout: 500 }).catch(() => {});
    await phone.page.waitForTimeout(150);
    const btn = await phone.page.$('.drill-open');
    if (btn) { await btn.click(); await phone.page.waitForTimeout(250); opened = !!(await phone.page.$('.drill-page .field')); }
  }
  const f = opened ? await phone.page.evaluate(measure, { phone: true }) : [];
  scen('a promoted group opens as its own page and passes the phone checks', opened && f.length === 0, f.map((x) => x.join(' ')).join('; '));
  await phone.ctx.close();
}

// ---- glance (ph-vdk.38): no pointer selects glance at any width (RFC-062
// draft item 2), categories become a menu stack (RENDERING §12) and the page
// scrolls rather than taking the desktop frame. Playwright cannot emulate
// (pointer: none), so matchMedia answers it for the class derivation only.
if (!ONLY || ONLY === 'glance') {
  console.log('\nglance scenarios');
  const { ctx, page } = await seeded({ width: 1280, height: 800 }, (ws) => fakeHub(ws));
  await ctx.addInitScript(() => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/pointer:\s*(none|coarse)/.test(q) ? { matches: /none/.test(q), media: q,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q));
  });
  await page.goto('http://127.0.0.1:' + PORT + '/');
  const up = await page.waitForSelector('nav.tabs [role=tab]', { timeout: 15000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(500);
  scen('no pointer at 1280 is glance with the tab menu', up && await page.evaluate(() => document.documentElement.dataset.rc) === 'glance');
  const stack = await page.$$eval('nav.tabs [role=tab]', (els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.top]));
  scen('categories are a vertical menu stack', stack.length > 1 && stack.every(([x, y], i) => i === 0 || (x === stack[0][0] && y > stack[i - 1][1])),
    JSON.stringify(stack.slice(0, 3)));
  let drilled = false;
  const tabs = page.locator('nav.tabs [role=tab]');
  for (let i = 1; i < await tabs.count() && !drilled; i++) {
    await tabs.nth(i).click();
    await page.waitForTimeout(250);
    const f = [...await page.evaluate(measure, { phone: false }), ...await page.evaluate(stripCheck)];
    scen('glance ' + (await tabs.nth(i).textContent()).trim() + ' passes the layout and strip checks', f.length === 0, f.map((x) => x.join(' ')).join('; '));
    const btn = await page.$('.drill-open');
    if (!btn) continue;
    await btn.click();
    await page.waitForTimeout(250);
    drilled = !!(await page.$('.drill-page'));
    scen('a subgroup screen replaces the menu', drilled && !(await page.isVisible('nav.tabs')));
    await page.click('.drill-back');
    await page.waitForTimeout(250);
    scen('back returns to the menu', await page.isVisible('nav.tabs [role=tab]'));
  }
  scen('found a promoted subgroup to open', drilled);
  await ctx.close();
}

// ---- scale (ph-e82.3): one context per (viewport, wished step); the wish is
// stored before boot, the model clamps it, every tab is checked at the
// applied step.
// ---- home (ph-e82.5): the full-class home in edit mode, palette open --------
if (!ONLY || ONLY === 'home') {
  console.log('\nhome scenarios');
  for (const [w, h] of [[1280, 720], [1920, 1080]]) {
    const { ctx, page } = await seeded({ width: w, height: h }, (ws) => fakeHub(ws));
    await page.goto('http://127.0.0.1:' + PORT + '/');
    await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 });
    await page.locator('.home .dash-toolbar button', { hasText: 'Edit layout' }).click();
    await page.$$eval('.palette details', (els) => els.forEach((d) => { d.open = true; }));
    await page.waitForTimeout(300);
    const f = [...await page.evaluate(measure, { phone: false }), ...await page.evaluate(stripCheck)];
    scen(w + 'x' + h + ': the home with its palette open passes the layout and strip checks', f.length === 0,
      f.map((x) => x.join(' ')).join('; '));
    scen(w + 'x' + h + ': each grid contains its own announce region (ph-e82.10)', await page.$$eval('.dash-wrap > [aria-live]',
      (els) => els.length > 0 && els.every((el) => el.offsetParent === el.parentElement)));
    const rows = await page.$eval('.home .dash-toolbar', (bar) => new Set([...bar.children]
      .filter((c) => c.getBoundingClientRect().height > 0).map((c) => { const r = c.getBoundingClientRect(); return Math.round(r.top + r.height / 2); })).size);
    scen(w + 'x' + h + ': the edit-mode toolbar holds one row (ph-e82.15)', rows === 1, rows + ' rows');
    await page.locator('.home .dash-toolbar button', { hasText: 'Layout…' }).click();
    const menu = await page.$eval('.dash-menu', (m) => {
      const r = m.getBoundingClientRect();
      const b = document.querySelector('[popovertarget="' + m.id + '"]').getBoundingClientRect();
      const strip = document.querySelector('.topstrip').getBoundingClientRect();
      return { open: m.matches(':popover-open'), in: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        beside: r.top >= b.bottom - 1 || r.bottom <= b.top + 1, clear: r.top >= strip.bottom };
    });
    scen(w + 'x' + h + ': the layout menu opens on screen beside its button, clear of the strip',
      menu.open && menu.in && menu.beside && menu.clear, JSON.stringify(menu));
    await page.keyboard.press('Escape');
    await ctx.close();
  }
  for (const [w, h] of [[320, 568], [360, 800]]) {
    const { ctx, page } = await seeded({ width: w, height: h }, (ws) => fakeHub(ws));
    await page.goto('http://127.0.0.1:' + PORT + '/');
    await page.waitForSelector('nav.tabs [role=tab]', { timeout: 15000 });
    await page.locator('.home .dash-toolbar button', { hasText: 'Edit layout' }).click();
    const f = (await page.evaluate(measure, { phone: true })).filter(([k]) => k === 'overflow' || k === 'target');
    await page.locator('.home .dash-toolbar button', { hasText: 'Layout…' }).click();
    const open = await page.$eval('.dash-menu', (m) => {
      const r = m.getBoundingClientRect();
      return document.scrollingElement.scrollWidth <= innerWidth + 0.5 && r.left >= 0 && r.right <= innerWidth;
    });
    scen(w + 'x' + h + ': the edit-mode toolbar fits a phone, and so does its open menu (ph-e82.15)', f.length === 0 && open,
      f.map((x) => x.join(' ')).join('; ') + (open ? '' : ' menu off screen'));
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(([etag, bytes, k, v]) => {
      try { localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes })); localStorage.setItem(k, v); } catch (e) { /* none */ }
    }, [ETAG, toHex(CAT), SCALE_KEY, String(SCALE_STEPS[0])]);
    await ctx.routeWebSocket(/:82\//, fakeHub);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => pageErrors.push('home: ' + e));
    await page.goto('http://127.0.0.1:' + PORT + '/');
    await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 });
    await page.locator('.home .dash-toolbar button', { hasText: 'Edit layout' }).click();
    const small = await page.$$eval('.dash-item .handle', (els) => els.map((e) => e.getBoundingClientRect())
      .filter((r) => r.width < 39.5 || r.height < 39.5).map((r) => Math.round(r.width) + 'x' + Math.round(r.height)));
    const n = await page.locator('.dash-item .handle').count();
    scen('1280x720 at scale ' + SCALE_STEPS[0] + ': every layout handle is at least 40 CSS px (law 12)', n > 0 && small.length === 0, n + ' handles; ' + small.slice(0, 4).join(', '));
    await ctx.close();
  }
}

if (!ONLY || ONLY === 'scale') {
  console.log('\nscale scenarios');
  async function atScale(w, h, coarse, step, check) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: coarse });
    await ctx.addInitScript(([etag, bytes, k, v]) => {
      try { localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes })); localStorage.setItem(k, v); } catch (e) { /* none */ }
    }, [ETAG, toHex(CAT), SCALE_KEY, String(step)]);
    await ctx.routeWebSocket(/:82\//, fakeHub);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => pageErrors.push('scale: ' + e));
    await page.goto('http://127.0.0.1:' + PORT + '/');
    const tabSel = w >= 960 ? 'nav.rail [role=tab]' : 'nav.tabs [role=tab]';
    await page.waitForSelector(tabSel, { timeout: 15000 });
    await page.waitForTimeout(300);
    // The scale lives in the edit-mode Layout menu (ph-e82.22).
    const applied = await (async () => {
      await page.locator('.home .dash-toolbar button', { hasText: 'Edit layout' }).click();
      await page.locator('.home .dash-toolbar button', { hasText: 'Layout…' }).click();
      const t = await page.$eval('.dash-menu .scale [aria-label="Reset scale"]', (e) => e.textContent.trim());
      await page.keyboard.press('Escape');
      await page.locator('.home .dash-toolbar .done-btn').click();
      return t;
    })().catch(() => '?');
    const out = [];
    for (let i = 0; i < await page.locator(tabSel).count(); i++) {
      await page.locator(tabSel).nth(i).click();
      await page.waitForTimeout(200);
      for (const f of await check(page)) out.push(f);
    }
    await ctx.close();
    return { applied, out };
  }
  const overflow = (page) => page.evaluate(() => {
    const sw = document.scrollingElement.scrollWidth;
    return sw > innerWidth + 0.5 ? ['scrollWidth ' + sw + ' > ' + innerWidth] : [];
  });
  for (const [w, h, coarse] of [[360, 800, true], [1280, 720, false], [3840, 2160, false]]) {
    const bad = [];
    for (const step of SCALE_STEPS) {
      const r = await atScale(w, h, coarse, step, overflow);
      if (r.out.length) bad.push(step + ' (applied ' + r.applied + '): ' + r.out[0]);
    }
    scen(w + 'x' + h + ': no horizontal page scroll at any scale step', bad.length === 0, bad.join('; '));
  }
  for (const [w, h] of [[320, 568], [360, 800], [390, 844]]) {
    const r = await atScale(w, h, true, SCALE_STEPS[0], async (page) =>
      (await page.evaluate(measure, { phone: true, coarse: true })).filter(([k]) => k === 'target').map(([, d]) => d));
    scen(w + 'x' + h + ': the smallest scale clamps (' + r.applied + ') and the target floor holds',
      r.applied !== '?' && r.applied !== Math.round(SCALE_STEPS[0] * 100) + '%' && r.out.length === 0, [...new Set(r.out)].slice(0, 4).join('; '));
  }
}

// ---- nest (ph-e82.6): a nest never traps the page scroll on a phone. Every
// card of the first multi-card category goes into one short nest through the
// stored layout (with the scroll flag an older build wrote, inert now).
if (!ONLY || ONLY === 'nest') {
  console.log('\nnest scenarios');
  for (const [w, h] of [[320, 568], [360, 800], [390, 844]]) {
    const { ctx, page } = await seeded({ width: w, height: h }, (ws) => fakeHub(ws));
    await page.goto('http://127.0.0.1:' + PORT + '/');
    await page.waitForSelector('nav.tabs [role=tab]', { timeout: 15000 });
    const tabs = page.locator('nav.tabs [role=tab]');
    let tab = -1, key = '', ids = [];
    for (let i = 1; i < await tabs.count() && tab < 0; i++) {
      await tabs.nth(i).click();
      await page.waitForTimeout(200);
      const g = await page.$eval('.dash-grid[data-view]', (el) => ({ key: el.getAttribute('data-view'),
        ids: [...el.children].map((c) => c.getAttribute('data-id')) })).catch(() => null);
      if (g && g.ids.length >= 2) { tab = i; key = g.key; ids = g.ids; }
    }
    const store = { active: 'Default', modules: {}, layouts: { Default: { [key]: {
      'nest:1': { x: 0, y: 0, w: 20, h: 4, nest: { title: 'Nest', scroll: true, map: Object.fromEntries(ids.map((id) => [id, null])) } },
    } } } };
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORE_KEY, JSON.stringify(store)]);
    await page.reload();
    await page.waitForSelector('nav.tabs [role=tab]', { timeout: 15000 });
    if (tab > 0) await tabs.nth(tab).click();
    await page.waitForTimeout(300);
    const body = page.locator('.dash-cell[data-id="nest:1"] .nest-body');
    const r = await body.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { overflow: cs.overflowY, sh: el.scrollHeight, ch: el.clientHeight, members: el.querySelectorAll('.dash-cell').length };
    }).catch(() => null);
    const tag = w + 'x' + h;
    scen(tag + ': the nest renders with every card', !!r && r.members === ids.length, JSON.stringify(r));
    scen(tag + ': the nest is not a scroll region of its own', !!r && /visible|clip/.test(r.overflow) && r.sh <= r.ch + 1, JSON.stringify(r));
    let moved = '';
    if (r) {
      await body.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 120));
      await page.waitForTimeout(100);
      const box = await body.boundingBox();
      const before = await page.evaluate(() => document.scrollingElement.scrollTop);
      await page.mouse.move(box.x + box.width / 2, Math.min(box.y + 60, h - 20));
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(250);
      const after = await page.evaluate(() => document.scrollingElement.scrollTop);
      moved = before + ' -> ' + after;
      scen(tag + ': a wheel over the nest scrolls the page', after > before, moved);
    }
    const f = await page.evaluate(measure, { phone: true });
    scen(tag + ': a page holding a nest passes the phone checks', f.length === 0, f.map((x) => x.join(' ')).join('; '));
    await ctx.close();
  }
}

// ---- builder (ph-e82.20): the night's grid and nest chrome at desktop and phone.
if (!ONLY || ONLY === 'builder') {
  console.log('\nbuilder scenarios');
  for (const [w, h] of [[1280, 720], [360, 800]]) {
    const phone = w < 600, tag = w + 'x' + h;
    const tabSel = phone ? 'nav.tabs [role=tab]' : 'nav.rail [role=tab]';
    const { ctx, page } = await seeded({ width: w, height: h }, (ws) => fakeHub(ws));
    await page.goto('http://127.0.0.1:' + PORT + '/');
    await page.waitForSelector(tabSel, { timeout: 15000 });
    const tabs = page.locator(tabSel);
    let tab = -1, key = '', ids = [];
    for (let i = 1; i < await tabs.count() && tab < 0; i++) {
      await tabs.nth(i).click();
      await page.waitForTimeout(200);
      const g = await page.$eval('.dash-grid[data-view]', (el) => ({ key: el.getAttribute('data-view'),
        ids: [...el.children].map((c) => c.getAttribute('data-id')).filter(Boolean) })).catch(() => null);
      if (g && g.ids.length >= 2) { tab = i; key = g.key; ids = g.ids; }
    }
    const store = { active: 'Default', modules: {}, layouts: { Default: { opts: { density: 'compact' }, [key]: {
      'nest:1': { x: 0, y: 0, w: 20, h: 6, nest: { title: 'Folded', scroll: true, collapsed: true, map: { [ids[0]]: null } } },
      'nest:2': { x: 0, y: 2, w: 20, h: 4, nest: { title: 'Empty', scroll: false, map: {} } },
    } } } };
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORE_KEY, JSON.stringify(store)]);
    await page.reload();
    await page.waitForSelector(tabSel, { timeout: 15000 });
    if (tab > 0) await tabs.nth(tab).click();
    await page.waitForTimeout(300);
    await page.locator('.dash-wrap[data-density] > .dash-toolbar button', { hasText: 'Edit layout' }).click();
    await page.locator('.dash-grid[data-view] > .dash-cell[data-id="' + ids[1] + '"] .handle.grab').click();
    await page.waitForTimeout(200);
    const ready = await page.evaluate(() => ({ compact: !!document.querySelector('.dash-wrap[data-density="compact"]'),
      member: !!document.querySelector('.dash-cell[data-id="nest:1"] .nest-body .dash-cell'), empty: !!document.querySelector('.nest-empty'),
      selbar: !!document.querySelector('.dash-selbar') }));
    scen(tag + ': the builder chrome is on screen (compact, nest with a member, empty nest, selection bar)',
      ready.compact && ready.member && ready.empty && ready.selbar, JSON.stringify(ready));
    const f = [...await page.evaluate(measure, { phone }), ...await page.evaluate(stripCheck)];
    scen(tag + ': the builder in edit mode passes the layout and strip checks', f.length === 0, f.map((x) => x.join(' ')).join('; '));
    await ctx.close();
  }
}

if (!ONLY || ONLY === 'phosphor') {
  console.log('\nphosphor scenarios');
  const SHELL = await buildShellPage();
  const sh = createServer((_q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(SHELL); });
  await new Promise((r) => sh.listen(0, '127.0.0.1', r));
  for (const [w, h] of [[1440, 900], [844, 390], [360, 800]]) {
    const phone = Math.min(w, h) < 600, tag = w + 'x' + h;
    const tabSel = w >= 960 ? 'nav.rail [role=tab]' : 'nav.tabs [role=tab]';
    // The served page with a hub: no Phosphor group.
    {
      const { ctx, page } = await seeded({ width: w, height: h }, (ws) => fakeHub(ws));
      await page.goto('http://127.0.0.1:' + PORT + '/');
      const up = await page.waitForSelector(tabSel, { timeout: 15000 }).then(() => true).catch(() => false);
      scen(tag + ': the served page has no shell panes', up && !(await page.$('[data-tab-id^="shell:"], .rail-sec.shell')));
      await ctx.close();
    }
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: phone });
    await ctx.addInitScript(TAURI_STUB);
    await ctx.addInitScript(([etag, bytes]) => {
      try {
        localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes }));
        localStorage.setItem('shell_host', '127.0.0.1');
      } catch (e) { /* none */ }
    }, [ETAG, toHex(CAT)]);
    await ctx.routeWebSocket(/:82\//, (ws) => fakeHub(ws));
    const page = await ctx.newPage();
    // The stub rejects every command; an unhandled one is the degraded shell, not this layout.
    page.on('pageerror', (e) => { if (!/stub: /.test(String(e))) pageErrors.push('phosphor: ' + e); });
    await page.goto('http://127.0.0.1:' + sh.address().port + '/');
    // The legacy saved host redials the fixture hub at launch.
    const ids = await page.waitForSelector('[data-tab-id="shell:about"]', { timeout: 15000 })
      .then(() => page.$$eval('[data-tab-id^="shell:"]', (els) => els.map((e) => e.dataset.tabId))).catch(() => []);
    scen(tag + ': the shell bundle carries the Phosphor tabs', ['hubs', 'server', 'settings', 'about'].every((p) => ids.includes('shell:' + p)), JSON.stringify(ids));
    for (const id of ids) {
      await page.click('[data-tab-id="' + id + '"]');
      await page.waitForTimeout(250);
      const f = [...await page.evaluate(measure, { phone, coarse: phone }), ...await page.evaluate(stripCheck)];
      scen(tag + ': Phosphor > ' + id.slice(6) + ' passes the layout and strip checks', f.length === 0, f.map((x) => x.join(' ')).join('; '));
      if (SHOTS) await page.screenshot({ path: join(OUT, 'phosphor-' + id.slice(6) + '-' + tag + '.png') });
    }
    await ctx.close();
  }
  sh.close();
}

await browser.close();
srv.close();

// Dedupe identical findings across views so the table reads per viewport.
const rows = new Map();
for (const [tag, view, k, d] of table) {
  const key = tag + '|' + k + '|' + d;
  const r = rows.get(key) || { tag, k, d, views: [] };
  r.views.push(view); rows.set(key, r);
}
console.log('\nresponsive matrix: ' + total + ' finding(s)\n');
for (const r of rows.values()) console.log('  ' + r.tag.padEnd(12) + r.k.padEnd(9) + r.d + '   [' + (r.views.length > 3 ? r.views.length + ' views' : r.views.join(',')) + ']');
if (pageErrors.length) { console.log('\npage errors:'); pageErrors.forEach((e) => console.log('  ' + e)); }
console.log('\n' + (total || pageErrors.length ? 'FAILURES' : 'ALL PASS -- every view holds at every size.'));
process.exit(total || pageErrors.length ? 1 : 0);
