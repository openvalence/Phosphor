/**
 * ble-setup.js -- "Set up a machine": the flow from a hub in config mode to
 * a WS session on its network (SPEC §13.4.1 clients, §13.9, §12.3, §6.3;
 * RFC-114 draft for the configure ask).
 *
 * Constraints:
 * - Pure: no Tauri and no Svelte import, so test/ble-setup.test.mjs drives it
 *   with a fake session, a fake clock and fake transports.
 * - The flow never touches a credential: the setup wizard (catalog-rendered)
 *   collects and sends them, then reports the press through joinBegin and
 *   joinResult. Nothing here sees, stores or logs a SSID or passphrase.
 * - The ask is a bare PAIR_REQ naming configure. It never spends a window
 *   that grants less (RFC-114), and the tier is read off PAIR_GRANT.
 * - A config-mode hub reboots after the answer, so the handover keeps
 *   looking until it connects or the flow stops: the ECHO's endpoint, then
 *   UDP discovery by hub_instance_id, then the endpoint the hub's
 *   advertisement carries. Never back to Bluetooth (SPEC §13.4.1).
 * - deps.connect verifies WELCOME's hub_instance_id. An advertised endpoint
 *   is a hint (SPEC §13.4): the token is stored for it only once the hub
 *   there proved to be this one, then the session reconnects with it.
 * - The channel is the core id and the result keys are SPEC §13.9's, never a
 *   name.
 */
import { ACCESS, ACCESS_NAME, NACK, LIMITS, bytesEqual, getInstanceId } from '../../../Valence/clients/js/index.js';
import { PAIRING_EVENT_KIND } from '../../../Valence/clients/js/frames.js';
import { CORE_CHANNEL } from '../../../Valence/clients/js/generated/registry_vocab.js';
import { ipv4ToString } from './ble-adv.js';
import { provisionRefusal } from '../model/provision.js';

export const SETUP = {
  scanning: 'scanning',
  connecting: 'connecting',
  asking: 'asking',
  waiting: 'waiting',
  granted: 'granted',
  provisioning: 'provisioning',
  joined: 'joined',
  handingOver: 'handing-over',
  done: 'done',
  failed: 'failed',
};

// SPEC §13.9 result keys of the provisioning ECHO. Hand-copied: codegen omits
// channel-local keys.
const KEY_IPV4 = 4;
const KEY_WS_PORT = 5;

export const ASK_EXPIRE_MS = LIMITS.pairing_window_default_s * 1000;
// A config-mode hub grants at once; the press prompt waits this long first.
export const ASK_GRACE_MS = 1500;
export const HANDOVER_MS = 30000;
export const HANDOVER_TRY_MS = 1500;
const REDISCOVER_EVERY = 4;

/** Needs setup: config mode only (SPEC §13.4.1); a hub offline outside it is reconnecting, not unset. */
export const needsSetup = (adv) => !!adv && adv.configMode === true;

const realClock = {
  now: () => Date.now(),
  after: (ms, fn) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
};

const PHASE = {
  [SETUP.scanning]: 'pending',
  [SETUP.connecting]: 'pending',
  [SETUP.asking]: 'pending',
  [SETUP.waiting]: 'pending',
  [SETUP.provisioning]: 'pending',
  [SETUP.handingOver]: 'pending',
  [SETUP.joined]: 'settled',
  [SETUP.done]: 'settled',
  [SETUP.failed]: 'fault',
};

/**
 * @param {object} deps
 * @param {(state) => void} [deps.onChange] every state change, a fresh object
 * @param {(origin, token: Uint8Array) => void} deps.setToken persist a PAIR_GRANT token for an origin {host, port}
 * @param {(host, port) => Promise<boolean>} deps.reach does the WS endpoint answer
 * @param {(target, hubId) => Promise<boolean>} deps.connect move the app's session to WS; true once live with WELCOME's
 *   hub_instance_id equal to hubId (when known)
 * @param {() => string|null} [deps.hubId] hub_instance_id learned from WELCOME
 * @param {(hubId) => Promise<{host, port}|null>} [deps.rediscover] UDP discovery by hub_instance_id
 * @param {() => Promise<{host, port}|null>} [deps.advertised] the endpoint the hub's BLE advertisement carries
 * @param {{now, after}} [deps.clock] a fake in tests
 * @param {Uint8Array} [deps.instanceId] this client's identity; the stored one by default
 */
export function createSetupFlow(deps) {
  const clock = deps.clock || realClock;
  let st = { step: SETUP.scanning, phase: 'pending', text: '', reason: null, retry: null, blocked: false, target: null };
  let session = null;
  let offs = [];
  let cancels = [];
  let rivals = new Set();
  let token = null;
  let hubId = null;
  let gen = 0;

  function set(step, text, extra = {}) {
    st = { step, phase: PHASE[step] || null, text, reason: null, retry: null, blocked: false, target: null, ...extra };
    deps.onChange?.(st);
  }
  function clearAsk() { cancels.forEach((c) => c()); cancels = []; }
  function fail(reason, text, retry, extra = {}) {
    clearAsk();
    set(SETUP.failed, text, { reason, retry, ...extra });
  }
  const sleep = (ms) => new Promise((r) => clock.after(ms, r));
  const idKey = (id) => Array.from(id, (b) => b.toString(16).padStart(2, '0')).join('');
  const own = (evt) => {
    const id = evt.body && evt.body.instance_id;
    return id instanceof Uint8Array && bytesEqual(id, deps.instanceId || getInstanceId());
  };
  const asking = () => st.step === SETUP.asking || st.step === SETUP.waiting;

  const waitingText = () => (rivals.size ? 'Another ask is pending: Pair is refused' : 'Press Pair on the machine');
  const setWaiting = () => set(SETUP.waiting, waitingText(), { blocked: rivals.size > 0 });

  function onEvent(evt) {
    if (evt.channel !== CORE_CHANNEL.pairing_events) return;
    const id = evt.body && evt.body.instance_id;
    if (!own(evt)) {
      if (!(id instanceof Uint8Array)) return;
      if (evt.kind === PAIRING_EVENT_KIND.knocked && (evt.body.role | 0) === ACCESS.configure) rivals.add(idKey(id));
      else rivals.delete(idKey(id));
      if (st.step === SETUP.waiting) setWaiting();
      return;
    }
    if (!asking()) return;
    if (evt.kind === PAIRING_EVENT_KIND.knocked) setWaiting();
    else if (evt.kind === PAIRING_EVENT_KIND.denied) fail('denied', 'Denied', 'ask');
    else if (evt.kind === PAIRING_EVENT_KIND.expired) fail('expired', 'Ask expired', 'ask');
  }

  function onNack(n) {
    if (!asking()) return;
    if (n.code === NACK.PAIRING_DENIED) fail('denied', 'Denied', 'ask');
    else if (n.code === NACK.BUSY) fail('busy', 'Pending list full', 'ask');
    else if (n.code === NACK.PAIRING_REQUIRED) fail('refused', 'Pairing is off on the machine', 'ask');
  }

  function onGrant(g) {
    // A grant after the ask expired is still the hub's answer to it.
    if (!asking() && !(st.step === SETUP.failed && st.retry === 'ask')) return;
    clearAsk();
    token = g.token || null;
    if (token && session) deps.setToken(session.origin, token);
    if ((g.role | 0) < ACCESS.configure) {
      fail('tier', 'Granted ' + (ACCESS_NAME[g.role | 0] || 'less') + ', not configure', 'ask');
      return;
    }
    set(SETUP.granted, '');
  }

  function onClose() {
    if (asking() || st.step === SETUP.granted || st.step === SETUP.provisioning) fail('link', 'Bluetooth link lost', 'connect');
  }

  return {
    get state() { return st; },

    scanning() { gen++; set(SETUP.scanning, ''); },
    connecting(text = '') { gen++; set(SETUP.connecting, text); },
    failLink(text) { fail('link', text, 'connect'); },

    /** Bind a welcomed BLE session and ask configure. Returns the detach. */
    attach(s) {
      this.detach();
      session = s;
      rivals = new Set();
      hubId = deps.hubId?.() || null;
      offs = [s.on('pairGrant', onGrant), s.on('event', onEvent), s.on('nack', onNack), s.on('close', onClose)];
      this.ask();
      return () => this.detach();
    },

    detach() {
      offs.forEach((o) => o());
      offs = [];
      clearAsk();
      session = null;
    },

    ask() {
      clearAsk();
      if (!session || !session.sendPairReq({ role: ACCESS.configure })) { fail('link', 'Not connected', 'connect'); return; }
      set(SETUP.asking, 'Asking for configure');
      cancels = [
        clock.after(ASK_GRACE_MS, () => { if (st.step === SETUP.asking) setWaiting(); }),
        clock.after(ASK_EXPIRE_MS, () => { if (asking()) fail('expired', 'Ask expired', 'ask'); }),
      ];
    },

    /** The wizard's provision press went out. */
    joinBegin() {
      if (st.step === SETUP.granted || (st.step === SETUP.failed && st.retry === 'join')) set(SETUP.provisioning, 'Joining');
    },

    /** The press concluded: runAction's result {ok, applied, code, detail, error}. */
    async joinResult(res) {
      if (st.step !== SETUP.provisioning && st.step !== SETUP.granted) return;
      if (!res.ok) {
        const why = provisionRefusal(res);
        fail(why ? why.reason : 'no_answer', why ? why.text : 'No answer from the hub', 'join');
        return;
      }
      const ip = Number(res.applied?.[KEY_IPV4]) || 0;
      const port = Number(res.applied?.[KEY_WS_PORT]) || 0;
      const target = ip && port ? { host: ipv4ToString(ip), port } : null;
      if (target && token) deps.setToken({ host: target.host, port: target.port }, token);
      set(SETUP.joined, target ? 'Joined ' + target.host : 'Joined', { target });
      await this.handover(target);
    },

    /**
     * Reach the hub on its network until it connects or the flow stops; past HANDOVER_MS the line says where it
     * stands (overdue) and the looking goes on.
     */
    async handover(target) {
      const mine = ++gen;
      const deadline = clock.now() + HANDOVER_MS;
      let seen = target;
      set(SETUP.handingOver, 'Waiting for the hub on WiFi', { target });
      for (let tries = 0; ; tries++) {
        let t = target;
        if (hubId && (!t || (tries && tries % REDISCOVER_EVERY === 0))) {
          const found = deps.rediscover ? await deps.rediscover(hubId).catch(() => null) : null;
          if (mine !== gen) return;
          if (found) {
            t = found;
            if (token) deps.setToken({ host: t.host, port: t.port }, token);
          } else if (deps.advertised) {
            const hint = await deps.advertised().catch(() => null);
            if (mine !== gen) return;
            if (hint) t = { host: hint.host, port: hint.port, hint: true };
          }
        }
        if (t) seen = t;
        if (t && await deps.reach(t.host, t.port)) {
          if (mine !== gen) return;
          set(SETUP.handingOver, 'Connecting to ' + t.host, { target: t });
          let ok = await deps.connect(t, hubId);
          if (ok && t.hint && token) {
            if (mine !== gen) return;
            deps.setToken({ host: t.host, port: t.port }, token);
            ok = await deps.connect(t, hubId);
          }
          if (mine !== gen) return;
          if (ok) { set(SETUP.done, 'Connected over WiFi', { target: t }); return; }
        }
        if (mine !== gen) return;
        if (clock.now() >= deadline) {
          set(SETUP.handingOver, seen ? 'Found at ' + seen.host + ', not reachable' : 'Not on WiFi yet, still looking',
            { target: seen, phase: 'overdue' });
        }
        await sleep(HANDOVER_TRY_MS);
        if (mine !== gen) return;
      }
    },

    /** Take the retry the failed state offers; 'connect' is the host's to redo. Returns the kind. */
    retry() {
      const r = st.step === SETUP.failed ? st.retry : null;
      if (r === 'ask') this.ask();
      else if (r === 'join') set(SETUP.granted, '');
      return r;
    },

    stop() { gen++; this.detach(); },
  };
}
