/**
 * core.js -- the health system's pure half (ph-9t5l): the condition table,
 * the cutout classifier, the hysteresis tracker and the growth detector.
 * No clock, DOM or Svelte: health.svelte.js feeds it, test/health.test.mjs
 * drives it on a fake clock.
 *
 * Constraints:
 * - `short` is the status slot and Log line (docs/COPY.md); `detail` is one
 *   plain sentence and `action` one act, both for an average DIYer
 *   (operator ruling 2026-10-09). Jargon lives in the evidence only.
 * - A condition with `needs` binds a role the Health roles RFC adds; until a
 *   catalog carries it the card says "not reported by this machine" and the
 *   tracker never sees it.
 * - Nothing here sends anything anywhere: no continuous telemetry, ever.
 */

/** id -> {area, sev, short, detail, action, hold, clear, act?, logOnly?, cause?, needs?, fold?}. Times in ms. */
export const CONDITIONS = {
  'cutout-client': { area: 'link', sev: 'warn', act: { n: 3, ms: 60000 }, clear: 30000, cause: 'client',
    short: 'Motion paused: this device fell behind',
    detail: 'This computer was too busy to send the next moves in time, so the machine stopped and waited.',
    action: 'Close other apps, or reload Phosphor' },
  'cutout-network': { area: 'link', sev: 'warn', act: { n: 3, ms: 60000 }, clear: 30000, cause: 'network',
    short: 'Motion paused: WiFi delay',
    detail: 'The moves left this device on time but reached the machine late, so it stopped and waited.',
    action: 'Move closer to the router, or set Stream buffer to 1000 ms' },
  'cutout-hub': { area: 'link', sev: 'warn', clear: 30000, cause: 'hub',
    short: 'Motion paused: machine fell behind',
    detail: 'The moves arrived on time, but the machine took too long to plan them.',
    action: 'Lower smoothness or speed; send a report' },
  'cutout-unknown': { area: 'link', sev: 'info', clear: 30000, cause: 'unknown',
    short: 'Motion paused: cause unknown',
    detail: 'The machine stopped briefly and the cause could not be pinned down.',
    action: 'Send a report if it repeats' },
  'send-margin': { area: 'link', sev: 'info', hold: 5000, clear: 10000,
    short: 'Sending close to the deadline',
    detail: 'Moves are leaving with little time to spare; a small hiccup will pause the machine.',
    action: 'Close other apps' },
  'slow-link': { area: 'link', sev: 'warn', hold: 10000, clear: 30000,
    short: 'Slow connection to the machine',
    detail: 'Messages take longer than usual to reach the machine and come back.',
    action: 'Move closer to the router' },
  'delay-spike': { area: 'link', sev: 'info', logOnly: true, clear: 30000,
    short: 'WiFi delay spike', detail: '', action: '' },
  'updates-stalled': { area: 'link', sev: 'warn', hold: 0, clear: 30000,
    short: 'Machine updates stalled',
    detail: "The machine's position updates stopped arriving for a moment.",
    action: 'Check the WiFi' },
  backlog: { area: 'link', sev: 'act', hold: 2000, clear: 10000,
    short: 'Connection jammed',
    detail: 'This device has data waiting that the network is not taking.',
    action: 'Check the WiFi; Phosphor reconnects if it lasts' },
  throttled: { area: 'link', sev: 'info', hold: 0, clear: 5000,
    short: 'Machine reduced update rate',
    detail: 'The machine is sending fewer updates because the connection is congested.',
    action: 'Disconnect other devices using the machine' },
  drops: { area: 'link', sev: 'warn', hold: 0, clear: 0,
    short: 'Connection keeps dropping',
    detail: 'The link to the machine keeps breaking and reconnecting.',
    action: 'Move the machine or the router closer' },
  'weak-signal': { area: 'link', sev: 'warn', hold: 30000, clear: 60000, needs: 'link.rssi',
    short: 'Machine WiFi signal weak',
    detail: 'The machine hears the router faintly, which causes delays.',
    action: 'Move the router closer; keep the antenna clear of metal' },
  'hub-wifi-drop': { area: 'link', sev: 'warn', clear: 60000, needs: 'link.drops',
    short: 'Machine WiFi dropped',
    detail: 'The machine lost its WiFi connection and rejoined.',
    action: 'Check the router' },

  busy: { area: 'device', sev: 'warn', hold: 120000, clear: 120000,
    short: 'This device is busy',
    detail: 'Phosphor is waiting on this computer; controls and motion may lag.',
    action: 'Close other apps' },
  freeze: { area: 'device', sev: 'info', logOnly: true, clear: 30000,
    short: 'This device froze', detail: '', action: '' },
  'slow-display': { area: 'device', sev: 'info', hold: 30000, clear: 30000,
    short: 'Display running slow',
    detail: 'The screen is updating less often than usual.',
    action: 'Close other apps' },
  growth: { area: 'device', sev: 'warn', hold: 0, clear: Infinity,
    short: 'Phosphor slows down over time',
    detail: 'Something in Phosphor keeps using more memory and time the longer it runs.',
    action: 'Reload Phosphor, then send a report' },
  // D6: workers past the session's baseline + 2 raise growth, in its words; never an incident of its own.
  workers: { area: 'device', sev: 'warn', fold: 'growth',
    short: 'Phosphor slows down over time',
    detail: 'Something in Phosphor keeps using more memory and time the longer it runs.',
    action: 'Reload Phosphor, then send a report' },
  overloaded: { area: 'device', sev: 'warn', hold: 0, clear: 60000,
    short: 'This computer is overloaded',
    detail: "The computer's processor is near its limit.",
    action: 'Close other apps' },
  background: { area: 'device', sev: 'warn', hold: 0, clear: 0,
    short: 'Phosphor is in the background',
    detail: 'Some systems slow down apps in the background, which can pause the machine.',
    action: 'Keep Phosphor in front while playing' },

  'late-plans': { area: 'machine', sev: 'warn', hold: 60000, clear: 120000, needs: 'plan.late',
    short: 'Machine planner running late',
    detail: 'The machine sometimes finishes planning a move after it should have started.',
    action: 'Lower smoothness; send a report' },
  fault: { area: 'machine', sev: 'act', hold: 0, clear: 0, needs: 'health.fault',
    short: 'Machine reports a fault',
    detail: 'The machine reports a fault and switched something off.',
    action: "Open the machine's Hardware page" },
  'hub-memory': { area: 'machine', sev: 'warn', hold: 0, clear: 60000, needs: 'telemetry.heap',
    short: 'Machine memory running low',
    detail: "The machine's controller has less free memory than it started with.",
    action: 'Restart the machine when idle' },
  hot: { area: 'machine', sev: 'warn', hold: 10000, clear: 30000,
    short: 'Machine running hot',
    detail: 'A part of the machine is close to its temperature limit.',
    action: 'Let it cool; check airflow' },
  'log-drops': { area: 'machine', sev: 'info', clear: 60000, needs: 'health.log_drops',
    short: 'Machine skipped log lines', detail: '', action: '' },
  restarted: { area: 'machine', sev: 'info', logOnly: true, clear: 30000,
    short: 'Machine restarted',
    detail: 'The machine rebooted since the last connection.',
    action: '' },
};

export const SEV_RANK = { info: 0, warn: 1, act: 2 };
export const CAUSE_WORD = { client: 'this device fell behind', network: 'WiFi delay', hub: 'machine fell behind', unknown: 'cause unknown' };
/** A cutout cause to its condition id. */
export const CUTOUT = { client: 'cutout-client', network: 'cutout-network', hub: 'cutout-hub', unknown: 'cutout-unknown' };

/** Same-cause episodes this close merge into one (ms). */
export const MERGE_MS = 10000;
/** A re-entry this soon after a close reopens the same incident (ms). */
export const REOPEN_MS = 60000;
/** The hub's motion tick (ms): a margin every deadline keeps. */
export const TICK_MS = 5;
/** Loop lag over this (ms) means the page itself was stalled. */
export const LAG_HEALTHY_MS = 50;

/** q-quantile (0..1) of the finite numbers in a, or null. */
export function quantile(a, q) {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null;
}
export const max = (a) => { const f = a.filter(Number.isFinite); return f.length ? Math.max(...f) : null; };
export const min = (a) => { const f = a.filter(Number.isFinite); return f.length ? Math.min(...f) : null; };

/**
 * One stream cutout's cause, first match wins (ph-9t5l note §3, phase 1:
 * CLIENT decisive from the send itself, likely from a stall before a
 * hub-reported starvation; NETWORK and HUB likely, no hub-side arrival stamps).
 * e: {clip, leadSendMinMs, latMs, rttP50Ms, owdUpMaxMs, owdRecentMaxMs (5 s),
 *     posGapMaxMs, periodMs, loopLagMaxMs, hidden, starved, hubWarn}; null or
 *     absent = not measured.
 * @returns {{cause: string, confidence: string, why: string}}
 */
export function classify(e) {
  const lat = e.latMs || 0;
  const need = lat + TICK_MS + (e.rttP50Ms || 0) / 2;
  const lead = e.leadSendMinMs;
  if (e.clip || (lead != null && lead < need)) {
    const also = [e.loopLagMaxMs > LAG_HEALTHY_MS && 'loop lag ' + Math.round(e.loopLagMaxMs) + ' ms', e.hidden && 'page hidden'].filter(Boolean);
    return { cause: 'client', confidence: 'decisive',
      why: (e.clip ? 'a move left after the last one ended' : 'sent ' + Math.round(lead) + ' ms ahead, need ' + Math.round(need)) + (also.length ? ', ' + also.join(', ') : '') };
  }
  const healthy = !(e.loopLagMaxMs > LAG_HEALTHY_MS);
  // The hub ran dry right after this page stalled or hid: the next moves left later than the hub
  // needed them, though over the nominal need (the hub plans one knot behind, so it needs more).
  if (e.starved && (!healthy || e.hidden)) {
    return { cause: 'client', confidence: 'likely', why: 'the machine ran out after ' + (e.hidden ? 'the page hid' : 'a ' + Math.round(e.loopLagMaxMs) + ' ms stall here') };
  }
  // A bundle reaches the hub owd_up after it left: late once that eats the lead less the hub's own budget.
  // A starvation the hub reports looks back 5 s: it can still be draining what a delay held up.
  const owd = e.starved && e.owdRecentMaxMs != null ? Math.max(e.owdRecentMaxMs, e.owdUpMaxMs ?? 0) : e.owdUpMaxMs;
  if (owd != null && lead != null && owd > lead - lat - TICK_MS) {
    return { cause: 'network', confidence: 'likely', why: 'uplink delay ' + Math.round(owd) + ' ms against ' + Math.round(lead) + ' ms sent ahead' };
  }
  if (e.posGapMaxMs != null && e.posGapMaxMs >= Math.max(3 * (e.periodMs || 0), 100) && healthy) {
    return { cause: 'network', confidence: 'likely', why: 'no position update for ' + Math.round(e.posGapMaxMs) + ' ms' };
  }
  if (e.starved && healthy && e.hubWarn > 0) {
    return { cause: 'hub', confidence: 'likely', why: 'sent on time, no delay seen, the machine logged ' + e.hubWarn + ' warning' + (e.hubWarn === 1 ? '' : 's') };
  }
  return { cause: 'unknown', confidence: 'likely', why: 'nothing decisive' };
}

/**
 * The growth alarm (D4): the heap floor (min per minute, MB) rising 8 MB per
 * 5-minute window for 3 windows running, or loop lag p95 at twice the session
 * baseline (minutes 1 to 5) for the last 5 minutes while the floor rises.
 * Oldest first, one entry per minute.
 */
export function growth(floorMb, lagP95Ms) {
  const n = floorMb.length;
  const win = (k) => min(floorMb.slice(Math.max(0, n - 5 * (k + 1)), n - 5 * k));
  if (n >= 20) {
    const w = [0, 1, 2, 3].map(win);
    if (w.every((x) => x != null) && w[0] - w[1] >= 8 && w[1] - w[2] >= 8 && w[2] - w[3] >= 8) return true;
  }
  if (n >= 11 && lagP95Ms.length >= 11) {
    const base = quantile(lagP95Ms.slice(1, 6), 0.5);
    const last = lagP95Ms.slice(-5);
    if (base > 0 && last.every((x) => x > 2 * base) && win(0) > win(1)) return true;
  }
  return false;
}

/**
 * The hysteresis tracker. `level(id, sev, now)` once per evaluation for a
 * level condition (sev null = clear), `event(id, now, info)` per episode of
 * an episodic one, `tick(now)` to close quiet episodic incidents.
 * Callbacks: open(inc), update(inc), close(inc).
 *
 * Constraints:
 * - A level condition enters after `hold` of continuous signal and clears
 *   after `clear` of none; an episodic one clears `clear` after its last
 *   episode. Same-condition episodes within MERGE_MS are one episode.
 * - A re-entry within REOPEN_MS of a close reopens that incident (count + 1).
 * - Severity only rises inside an incident: warn becomes act by the
 *   condition's rate (`act`) or a level signal of act; it falls only when
 *   the incident closes and a new one opens.
 */
export function createTracker(cb = {}) {
  const st = {}; // id -> {since, quiet}
  const incs = {}; // id -> the open or last incident
  const raise = (inc, sev) => { if (SEV_RANK[sev] > SEV_RANK[inc.sev]) inc.sev = sev; };
  const rate = (d, inc, now) => { if (d.act && inc.episodes.filter((t) => now - t <= d.act.ms).length >= d.act.n) raise(inc, 'act'); };

  function open(id, now, sev, info) {
    const last = incs[id];
    if (last && last.closedAt != null && now - last.closedAt <= REOPEN_MS) {
      last.closedAt = null;
      last.count++;
      last.episodes.push(now);
      last.lastAt = now;
      raise(last, sev);
      if (info) Object.assign(last, info);
      return last;
    }
    const inc = { cond: id, sev, count: 1, t0: now, lastAt: now, closedAt: null, durationMs: 0, priorMs: 0, epMs: 0, episodes: [now], ...info };
    incs[id] = inc;
    return inc;
  }
  function close(id, now) {
    const inc = incs[id];
    if (!inc || inc.closedAt != null) return;
    inc.closedAt = now;
    cb.close && cb.close(inc);
  }
  const announce = (inc) => (inc.count === 1 && inc.episodes.length === 1 ? cb.open : cb.update)?.(inc);

  return {
    incidents: incs,
    level(id, sev, now, info) {
      const d = CONDITIONS[id];
      const s = st[id] || (st[id] = { since: null, quiet: null });
      const inc = incs[id];
      const isOpen = inc && inc.closedAt == null;
      if (sev) {
        s.quiet = null;
        if (s.since == null) s.since = now;
        if (isOpen) {
          raise(inc, sev);
          inc.lastAt = now;
          inc.durationMs = now - inc.t0;
          if (info) Object.assign(inc, info);
        } else if (now - s.since >= (d.hold || 0)) announce(open(id, now, sev, info));
      } else {
        s.since = null;
        if (!isOpen) return;
        if (s.quiet == null) s.quiet = now;
        if (now - s.quiet >= (d.clear || 0)) close(id, now);
      }
    },
    /** info.sizeMs sizes the episode; info.overlap: samples of one episode overlap (the largest counts), else they add. */
    event(id, now, info = {}) {
      const d = CONDITIONS[id];
      const inc = incs[id];
      const sizeMs = info.sizeMs || 0;
      const next = (o) => { o.priorMs += o.epMs; o.epMs = sizeMs; };
      if (inc && inc.closedAt == null) {
        if (now - inc.lastAt > MERGE_MS) { inc.count++; inc.episodes.push(now); next(inc); }
        else inc.epMs = info.overlap ? Math.max(inc.epMs, sizeMs) : inc.epMs + sizeMs;
        inc.lastAt = now;
        inc.durationMs = inc.priorMs + inc.epMs;
        // A measured cause outranks an inferred one for the same incident.
        const keep = inc.confidence === 'decisive' && info.confidence && info.confidence !== 'decisive';
        Object.assign(inc, keep ? { ...info, confidence: inc.confidence, why: inc.why, evidence: inc.evidence } : info);
        rate(d, inc, now);
        cb.update && cb.update(inc);
        return inc;
      }
      const o = open(id, now, d.sev, info);
      if (o.count > 1) next(o); else o.epMs = sizeMs;
      o.durationMs = o.priorMs + o.epMs;
      rate(d, o, now);
      announce(o);
      return o;
    },
    /** Closes episodic incidents quiet past their clear hold. */
    tick(now) {
      for (const [id, inc] of Object.entries(incs)) {
        const d = CONDITIONS[id];
        if (inc.closedAt == null && (d.logOnly || d.cause) && now - inc.lastAt >= d.clear) close(id, now);
      }
    },
  };
}

/** An incident's evidence as one line (numbers, jargon allowed: it sits under the plain words). */
export function evidenceText(e) {
  if (!e) return '';
  const r = (v) => Math.round(v) + ' ms';
  return [
    e.leadSendMinMs != null && 'sent ahead ' + r(e.leadSendMinMs),
    e.latMs != null && 'machine planning ' + r(e.latMs),
    e.rttP50Ms != null && 'round trip ' + r(e.rttP50Ms),
    e.owdUpMaxMs != null && 'uplink max ' + r(e.owdUpMaxMs),
    e.posGapMaxMs != null && 'update gap ' + r(e.posGapMaxMs),
    e.loopLagMaxMs != null && 'loop lag ' + r(e.loopLagMaxMs),
    e.backlogMax > 0 && 'backlog ' + e.backlogMax + ' B',
    e.hidden && 'page hidden',
  ].filter(Boolean).join(' · ');
}
