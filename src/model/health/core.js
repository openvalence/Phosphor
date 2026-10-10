/**
 * core.js -- the health system's pure half (ph-9t5l): the condition table,
 * the cutout classifier, the hysteresis tracker and the growth detector.
 * No clock, DOM or Svelte: health.svelte.js feeds it, test/health.test.mjs
 * drives it on a fake clock.
 *
 * Constraints:
 * - `line` is the status slot, the Log and the Health list: a measured fact
 *   with the number that raised it, never a verdict about Phosphor
 *   (operator 2026-10-09). `what`, `limit` and `action` are the tooltip and
 *   the incident's detail: what was measured, the threshold, one act; never
 *   the line again. `detail` is one plain sentence for an average DIYer.
 *   Jargon lives in the evidence only.
 * - A level condition's numbers ride its incident as `m`, refreshed while
 *   its signal holds; `line(m, inc)` must survive an empty `m` (a restored
 *   incident).
 * - A condition with `needs` binds a role the Health roles RFC adds; until a
 *   catalog carries it the card says "not reported by this machine" and the
 *   tracker never sees it.
 * - Nothing here sends anything anywhere: no continuous telemetry, ever.
 */

const num = (v, dp = 0) => (Number.isFinite(v) ? (dp ? v.toFixed(dp) : String(Math.round(v))) : '--');
const ms = (v) => num(v) + ' ms';
export const secs = (v) => (v < 10000 ? (v / 1000).toFixed(1) : Math.round(v / 1000)) + ' s';
/** Under a second in ms, else seconds. */
export const span = (v) => (Number.isFinite(v) && v < 1000 ? Math.round(v) + ' ms' : secs(v || 0));
const bytes = (v) => (!Number.isFinite(v) ? '-- B' : v < 1024 ? v + ' B' : (v / 1024).toFixed(1) + ' KB');
const plural = (n, one) => num(n) + ' ' + one + (n === 1 ? '' : 's');
const PAUSE = { limit: 'Any pause while moves were due' };

/**
 * id -> {area, sev, line(m, inc), what, limit, detail, action, hold, clear, act?, logOnly?, cause?, needs?}.
 * Times in ms; `what` and `limit` are strings or (m, inc) -> string. A cutout's line and `what` come
 * from its classifier (lineOf, tipLines).
 */
export const CONDITIONS = {
  'cutout-client': { area: 'link', sev: 'warn', act: { n: 3, ms: 60000 }, clear: 30000, cause: 'client', ...PAUSE,
    detail: 'This computer was too busy to send the next moves in time, so the machine stopped and waited.',
    action: 'Close other apps' },
  'cutout-network': { area: 'link', sev: 'warn', act: { n: 3, ms: 60000 }, clear: 30000, cause: 'network', ...PAUSE,
    detail: 'The moves left this device on time but reached the machine late, so it stopped and waited.',
    action: 'Move closer to the router' },
  'cutout-hub': { area: 'link', sev: 'warn', clear: 30000, cause: 'hub', ...PAUSE,
    detail: 'The moves arrived on time, but the machine took too long to plan them.',
    action: 'Send a report' },
  'cutout-unknown': { area: 'link', sev: 'info', clear: 30000, cause: 'unknown', ...PAUSE,
    detail: 'The machine stopped briefly and the cause could not be pinned down.',
    action: 'Send a report if it repeats' },
  'send-margin': { area: 'link', sev: 'info', hold: 5000, clear: 10000,
    line: (m) => 'Moves sent only ' + ms(m.leadMs) + ' ahead',
    what: 'Least time a move left before it was due, each second',
    limit: (m) => 'Raised under ' + ms(m.onMs) + ' for 5 s',
    detail: 'Moves are leaving with little time to spare; a small hiccup will pause the machine.',
    action: 'Close other apps' },
  'slow-link': { area: 'link', sev: 'warn', hold: 10000, clear: 30000,
    line: (m) => 'Round trip ' + ms(m.p50Ms) + ', worst ' + ms(m.p95Ms),
    what: 'Typical and slowest 5% round trip to the machine, last minute',
    limit: 'Raised over 50 ms typical or 30 ms above it at worst, for 10 s',
    detail: 'Messages take longer than usual to reach the machine and come back.',
    action: 'Move closer to the router' },
  'delay-spike': { area: 'link', sev: 'info', logOnly: true, clear: 30000,
    line: (m, i) => 'WiFi delay spike ' + ms(i.peakMs),
    what: 'One round trip or one-way delay sample', limit: 'Logged over 4 times the usual and over 100 ms', detail: '', action: '' },
  'updates-stalled': { area: 'link', sev: 'warn', hold: 0, clear: 30000,
    line: (m, i) => 'No machine updates for ' + span(i.peakMs),
    what: 'Time since the last message from the machine',
    limit: 'Raised at 0.5 s on a live link while this page runs',
    detail: "The machine's position updates stopped arriving for a moment.",
    action: 'Check the WiFi' },
  backlog: { area: 'link', sev: 'act', hold: 2000, clear: 10000,
    line: (m) => bytes(m.bytes) + ' waiting to send',
    what: 'Data this device queued that the network has not taken',
    limit: 'Raised when data waits 2 s',
    detail: 'This device has data waiting that the network is not taking.',
    action: 'Check the WiFi' },
  throttled: { area: 'link', sev: 'info', hold: 0, clear: 5000,
    line: (m) => 'Machine cut updates on ' + plural(m.channels, 'channel'),
    what: 'Channels the machine now updates less often than it granted',
    limit: 'Raised on any cut',
    detail: 'The machine is sending fewer updates because the connection is too busy.',
    action: 'Disconnect other devices using the machine' },
  drops: { area: 'link', sev: 'warn', hold: 0, clear: 0,
    line: (m) => 'Link dropped ' + plural(m.n, 'time') + ' in 5 min',
    what: 'Reconnects to the machine, last 5 minutes',
    limit: 'Raised at 2 in 5 min, clears after 10 min without one',
    detail: 'The link to the machine keeps breaking and reconnecting.',
    action: 'Move the machine or the router closer' },
  'weak-signal': { area: 'link', sev: 'warn', hold: 30000, clear: 60000, needs: 'link.rssi',
    line: (m) => 'Machine WiFi signal ' + num(m.dbm) + ' dBm',
    what: 'How strongly the machine hears the router',
    limit: 'Raised under -75 dBm for 30 s',
    detail: 'The machine hears the router faintly, which causes delays.',
    action: 'Move the router closer' },
  'hub-wifi-drop': { area: 'link', sev: 'warn', clear: 60000, needs: 'link.drops',
    line: (m) => 'Machine WiFi dropped ' + plural(m.n, 'time'),
    what: 'WiFi disconnects the machine counted',
    limit: 'Raised on any drop',
    detail: 'The machine lost its WiFi connection and rejoined.',
    action: 'Check the router' },

  busy: { area: 'device', sev: 'warn', hold: 120000, clear: 120000,
    line: (m) => 'Responses delayed up to ' + ms(m.p95Ms),
    what: 'Slowest 5% of timer checks on this computer, last minute',
    limit: 'Raised over 25 ms for 2 min, urgent over 100 ms',
    detail: 'Phosphor is waiting on this computer; controls and motion may lag.',
    action: 'Close other apps' },
  freeze: { area: 'device', sev: 'info', logOnly: true, clear: 30000,
    line: (m, i) => 'This computer froze ' + span(i.peakMs),
    what: 'One stall of this page', limit: 'Logged at 0.25 s', detail: '', action: '' },
  'rail-stalled': { area: 'link', sev: 'warn', hold: 10000, clear: 30000,
    line: (m) => 'Rail stalled on ' + num(m.pct) + '% of frames',
    what: 'Frames with no newer sample to draw, so samples arrive late or bunched',
    limit: 'Raised over 10% of frames for 10 s',
    detail: 'The rail has no newer position to draw between updates, so the dot stands still then jumps.',
    action: 'Move the machine or the router closer' },
  'clock-drift': { area: 'device', sev: 'warn', hold: 10000, clear: 30000,
    line: (m) => 'Clock drift ' + num(m.ms) + ' ms',
    what: "This computer's clocks disagree, so the rail's timing is off",
    limit: 'Raised over 2 ms for 10 s',
    detail: "The window's frame clock and the wall clock disagree, so the rail draws at the wrong instant.",
    action: 'Restart Phosphor if it persists' },
  'slow-display': { area: 'device', sev: 'info', hold: 30000, clear: 30000,
    line: (m) => 'Screen drawing ' + num(m.fps) + ' frames a second',
    what: 'Frames drawn per second while the window shows',
    limit: 'Raised under 30 for 30 s',
    detail: 'The screen is updating less often than usual.',
    action: 'Close other apps' },
  growth: { area: 'device', sev: 'warn', hold: 0, clear: 300000,
    line: (m) => 'Memory up ' + num(m.nowMb - m.baseMb) + ' MB in ' + num(m.minutes) + ' min',
    what: (m) => 'Lowest memory reading per 5 min, ' + num(m.baseMb) + ' to ' + num(m.nowMb) + ' MB, +' + num(m.slopeMbPerMin, 1) + ' MB a minute',
    limit: 'Raised at +100 MB, higher every 5 min for 30 min or more',
    detail: 'The memory left after each cleanup keeps rising, so something is kept and never freed.',
    action: 'Restart Phosphor to free it' },
  workers: { area: 'device', sev: 'warn', hold: 0, clear: 300000,
    line: (m) => 'Background tasks up from ' + num(m.base) + ' to ' + num(m.now),
    what: 'Workers this page started and has not ended',
    limit: "Raised over the first minutes' count + 2 for 5 min",
    detail: 'Background tasks keep piling up instead of ending.',
    action: 'Restart Phosphor to end them' },
  overloaded: { area: 'device', sev: 'warn', hold: 0, clear: 60000,
    line: (m) => 'Processor load ' + (m.state || '--') + ' for ' + span(m.forMs),
    what: "The system's processor pressure reading",
    limit: 'Raised at serious for 30 s or critical for 10 s',
    detail: "The computer's processor is near its limit.",
    action: 'Close other apps' },
  background: { area: 'device', sev: 'warn', hold: 0, clear: 0,
    line: (m, i) => 'Window hidden while playing' + (i.closedAt != null && i.durationMs >= 1000 ? ' · ' + secs(i.durationMs) : ''),
    what: 'Whether the window shows while moves stream',
    limit: 'Raised when it hides mid-stream',
    detail: 'Some systems slow down apps in the background, which can pause the machine.',
    action: 'Keep Phosphor in front while playing' },

  'late-plans': { area: 'machine', sev: 'warn', hold: 60000, clear: 120000, needs: 'plan.late',
    line: (m) => 'Machine planned ' + plural(m.perMin, 'move') + ' late a minute',
    what: 'Moves the machine planned after they should have started',
    limit: 'Raised over 6 a minute for 1 min',
    detail: 'The machine sometimes works out a move after it should have started.',
    action: 'Send a report' },
  fault: { area: 'machine', sev: 'act', hold: 0, clear: 0, needs: 'health.fault',
    line: (m) => 'Machine fault: ' + (m.label || 'unnamed'),
    what: "The machine's fault flags", limit: 'Raised on any fault',
    detail: 'The machine reports a fault and switched something off.',
    action: "Open the machine's Hardware page" },
  'hub-memory': { area: 'machine', sev: 'warn', hold: 0, clear: 60000, needs: 'telemetry.heap',
    line: (m) => 'Machine free memory down ' + num(m.dropPct) + '%',
    what: "The machine's largest free memory block against its start",
    limit: 'Raised at 20% down over 30 min',
    detail: "The machine's controller has less free memory than it started with.",
    action: 'Restart the machine when idle' },
  hot: { area: 'machine', sev: 'warn', hold: 10000, clear: 30000,
    line: (m) => (m.label || 'Machine') + ' at ' + (m.text || '--') + ', limit ' + num(m.max),
    what: 'Temperatures the machine reports, against their declared maximum',
    limit: 'Raised within 10% of the maximum for 10 s',
    detail: 'A part of the machine is close to its temperature limit.',
    action: 'Let it cool' },
  'log-drops': { area: 'machine', sev: 'info', clear: 60000, needs: 'health.log_drops',
    line: (m) => 'Machine skipped ' + plural(m.n, 'log line'),
    what: 'Log lines the machine could not send', limit: 'Logged on any skip', detail: '', action: '' },
  restarted: { area: 'machine', sev: 'info', logOnly: true, clear: 30000,
    line: () => 'Machine restarted',
    what: 'Its boot id changed since the last connection', limit: 'Logged on any change',
    detail: 'The machine rebooted since the last connection.',
    action: '' },
};

export const SEV_RANK = { info: 0, warn: 1, act: 2 };
/** A cutout's words when its classifier left no measured fact (a restored incident). */
export const CAUSE_WORD = { client: 'this device fell behind', network: 'WiFi delay', hub: 'machine fell behind', unknown: 'cause unknown' };
/** A cutout cause to its condition id. */
export const CUTOUT = { client: 'cutout-client', network: 'cutout-network', hub: 'cutout-hub', unknown: 'cutout-unknown' };

/** An incident's one line: the status slot, the Log and the Health list. */
export function lineOf(inc) {
  const d = CONDITIONS[inc.cond];
  const n = inc.count > 1 ? ' ×' + inc.count : '';
  if (d.cause) {
    return 'Motion paused ' + span(inc.durationMs) + ' · ' + (inc.fact || CAUSE_WORD[d.cause])
      + (inc.confidence === 'likely' && d.cause !== 'unknown' ? ' (likely)' : '') + n;
  }
  return d.line(inc.m || {}, inc) + n;
}

/**
 * The slot's tooltip and the incident's detail, one fragment a line: what was
 * measured, since when, the threshold, the one action. Never the line again.
 */
export function tipLines(inc) {
  const d = CONDITIONS[inc.cond];
  const f = (x) => (typeof x === 'function' ? x(inc.m || {}, inc) : x);
  // A measure over a window (growth) started at m.from, in the same clock as t0.
  const back = (d.hold || 0) + (inc.m && Number.isFinite(inc.m.from) && inc.t0 != null ? inc.t0 - inc.m.from : 0);
  const since = inc.wallAt != null && 'Since ' + new Date(inc.wallAt - back).toLocaleTimeString()
    + (inc.count > 1 ? ', ' + inc.count + ' times' : '');
  return [d.cause ? inc.why && 'Measured: ' + inc.why : f(d.what), since, f(d.limit), d.action].filter(Boolean);
}

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
 * @returns {{cause: string, confidence: string, why: string, fact: string}} fact: the line's plain words with the number
 */
export function classify(e) {
  const lat = e.latMs || 0;
  const need = lat + TICK_MS + (e.rttP50Ms || 0) / 2;
  const lead = e.leadSendMinMs;
  const stalled = e.loopLagMaxMs > LAG_HEALTHY_MS;
  const here = e.hidden ? 'window hidden' : stalled ? 'this device stalled ' + Math.round(e.loopLagMaxMs) + ' ms' : null;
  if (e.clip || (lead != null && lead < need)) {
    const also = [stalled && 'stalled ' + Math.round(e.loopLagMaxMs) + ' ms', e.hidden && 'window hidden'].filter(Boolean);
    return { cause: 'client', confidence: 'decisive',
      why: (e.clip ? 'a move left after the last one ended' : 'sent ' + Math.round(lead) + ' ms ahead, need ' + Math.round(need)) + (also.length ? ', ' + also.join(', ') : ''),
      fact: here || (e.clip ? 'moves sent late' : 'moves sent only ' + Math.round(lead) + ' ms ahead') };
  }
  // The hub ran dry right after this page stalled or hid: the next moves left later than the hub
  // needed them, though over the nominal need (the hub plans one knot behind, so it needs more).
  if (e.starved && (stalled || e.hidden)) {
    return { cause: 'client', confidence: 'likely', why: 'the machine ran out after ' + (e.hidden ? 'the window hid' : 'a ' + Math.round(e.loopLagMaxMs) + ' ms stall here'), fact: here };
  }
  // A bundle reaches the hub owd_up after it left: late once that eats the lead less the hub's own budget.
  // A starvation the hub reports looks back 5 s: it can still be draining what a delay held up.
  const owd = e.starved && e.owdRecentMaxMs != null ? Math.max(e.owdRecentMaxMs, e.owdUpMaxMs ?? 0) : e.owdUpMaxMs;
  if (!stalled && owd != null && lead != null && owd > lead - lat - TICK_MS) {
    return { cause: 'network', confidence: 'likely', why: 'delay to the machine ' + Math.round(owd) + ' ms against ' + Math.round(lead) + ' ms sent ahead',
      fact: 'WiFi delay ' + Math.round(owd) + ' ms' };
  }
  if (e.posGapMaxMs != null && e.posGapMaxMs >= Math.max(3 * (e.periodMs || 0), 100) && !stalled) {
    return { cause: 'network', confidence: 'likely', why: 'no position update for ' + Math.round(e.posGapMaxMs) + ' ms',
      fact: 'no updates for ' + Math.round(e.posGapMaxMs) + ' ms' };
  }
  if (e.starved && !stalled && e.hubWarn > 0) {
    return { cause: 'hub', confidence: 'likely', why: 'sent on time, no delay seen, the machine logged ' + e.hubWarn + ' warning' + (e.hubWarn === 1 ? '' : 's'),
      fact: 'machine fell behind' };
  }
  return { cause: 'unknown', confidence: 'likely', why: 'nothing decisive', fact: 'cause unknown' };
}

/** D4 thresholds (operator 2026-10-09: tens of MB never trips it). */
export const GROWTH = { blockMin: 5, blocks: 6, riseMb: 100 };

/**
 * The growth alarm (D4): a leak, never a GC sawtooth. The floor of each
 * 5-minute block (its lowest one-minute floor: the sawtooth's troughs, never
 * its peaks) has been higher than the block before for GROWTH.blocks blocks
 * or more, up to now, and the run rose GROWTH.riseMb or more. A one-time step
 * (a big script loaded) breaks the run; a sawtooth never starts one.
 * floorMb: one entry per minute (that minute's lowest reading), oldest first.
 * @returns null, or {baseMb, nowMb, minutes, slopeMbPerMin} over the run
 */
export function growth(floorMb) {
  const { blockMin: k, blocks: n, riseMb } = GROWTH;
  const nb = Math.floor(floorMb.length / k);
  if (nb < n) return null;
  const tail = floorMb.slice(floorMb.length - nb * k);
  const w = Array.from({ length: nb }, (_, i) => min(tail.slice(i * k, (i + 1) * k)));
  let i = nb - 1;
  while (i > 0 && w[i] != null && w[i - 1] != null && w[i] > w[i - 1]) i--;
  const run = nb - i, rise = w[nb - 1] - w[i];
  // Block floors k minutes apart: the run rose over k * (run - 1) minutes.
  return run >= n && rise >= riseMb ? { baseMb: w[i], nowMb: w[nb - 1], minutes: k * (run - 1), slopeMbPerMin: rise / (k * (run - 1)) } : null;
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
      // A close let the severity fall: the reopened incident starts from the signal, the rate raises it again.
      last.sev = sev;
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
        Object.assign(inc, keep ? { ...info, confidence: inc.confidence, why: inc.why, fact: inc.fact, evidence: inc.evidence } : info);
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
