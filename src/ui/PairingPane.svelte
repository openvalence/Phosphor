<script>
  /**
   * PairingPane.svelte -- the pairing ceremony from both sides (RFC-027):
   * this client's own knock, approving or denying other clients' knocks, the
   * trust ledger, and control ownership with eviction.
   *
   * Constraints:
   * - /uitoken mints a short-lived `control` credential to anything on the
   *   LAN, so it can never be the route to `configure`; only a ceremony is.
   *   This pane always sends a BARE knock (no PIN): whether it lands as
   *   knock-and-approve or push-to-pair is the hub's window state at arrival.
   * - Surfaces bind by spec-core id (CORE_CHANNEL), never by name (law 6).
   *   The pending list and the ledger need `configure` to read, so a lower
   *   session sees locked rows with the reason, never an empty list.
   * - The tier is mirrored from session events: the hub upgrades a session in
   *   place on PAIR_GRANT, before any reconnect updates machine.link.
   * - Every slot and status line is always rendered: knocks fill fixed rows
   *   (pairing_pending_max), and a reason appearing never moves a button.
   * - Admin writes (approve, deny, evict) show the shadow ladder of the one
   *   session-admin op key, with its text (law 5); faults read amber.
   * - The window countdown is counted from the window_opened EVENT against
   *   the registry default and labeled as such: the hub does not send it.
   */
  import { machine, getSession, coreEntry } from '../model/machine.svelte.js';
  import { CORE_CHANNEL } from '../../../Valence/clients/js/generated/registry_vocab.js';
  import { runAction, statusOf, shadowOf } from '../model/shadow.svelte.js';
  import { WIDGET } from '../model/settings.js';
  import { ACCESS, ACCESS_NAME, NACK, LIMITS, bytesEqual, getInstanceId, setPairedToken } from '../../../Valence/clients/js/index.js';
  import { PAIRING_MODE, PAIRING_MODE_NAME, PAIRING_EVENT_KIND } from '../../../Valence/clients/js/frames.js';
  import ProvisionWizard from './ProvisionWizard.svelte';
  import Roster from './widgets/Roster.svelte';
  import { rosterOfStore } from './widgets/roster.js';
  import { provisionCategory } from './wizard/steps.js';
  import './pane.css';

  const setupCat = $derived(provisionCategory(machine.catalog.model));
  let setupOpen = $state(false);

  const pendingEntry = $derived(coreEntry(CORE_CHANNEL.pending_pairing));
  const adminEntry = $derived(coreEntry(CORE_CHANNEL.session_admin));
  const ledgerEntry = $derived(coreEntry(CORE_CHANNEL.paired_devices));
  // RFC-070 store_id link first; the registry pairs 0x000D with 0x000C by identity.
  const ledgerRoster = $derived(ledgerEntry
    ? rosterOfStore(machine.catalog.entries, ledgerEntry) || coreEntry(CORE_CHANNEL.paired_devices_roster) : null);
  const sample = $derived(pendingEntry ? machine.samples[pendingEntry.id] : null);

  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => { now = Date.now(); }, 1000);
    return () => clearInterval(id);
  });

  // ---- live tier + window state from session-level events --------------------
  let liveRoles = $state(machine.link.roles | 0);
  let pairingModes = $state(0);
  let liveWindowOpen = $state(false);
  let windowOpenedAt = $state(0);
  let boundSession = null;

  $effect(() => {
    // Re-runs as the link progresses, so a pane mounted before connect binds later.
    void machine.link.phase;
    const s = getSession();
    if (!s || s === boundSession) return;
    boundSession = s;

    const syncRoles = () => { liveRoles = s.state.roles || 0; };
    syncRoles();

    const offWelcome = s.on('welcome', (w) => {
      syncRoles();
      pairingModes = w.pairingModes || 0;
      // A connect-time snapshot; window_opened/closed EVENTs keep it live.
      liveWindowOpen = (pairingModes & PAIRING_MODE.push_to_pair) !== 0;
      windowOpenedAt = 0;
    });
    const offGrant = s.on('grant', syncRoles);
    const offPairGrant = s.on('pairGrant', (g) => { syncRoles(); onPairGrant(g); });
    const offEvent = s.on('event', (evt) => {
      if (evt.channel !== CORE_CHANNEL.pairing_events) return;
      if (evt.kind === PAIRING_EVENT_KIND.window_opened) { liveWindowOpen = true; windowOpenedAt = Date.now(); }
      else if (evt.kind === PAIRING_EVENT_KIND.window_closed) { liveWindowOpen = false; windowOpenedAt = 0; }
      onPairingEvent(evt);
    });
    const offNack = s.on('nack', (n) => {
      if (n.code === NACK.PAIRING_REQUIRED || n.code === NACK.PAIRING_DENIED || n.code === NACK.BUSY) onPairingNack(n);
    });

    return () => {
      offWelcome(); offGrant(); offPairGrant(); offEvent(); offNack();
      if (boundSession === s) boundSession = null;
    };
  });

  const tierName = $derived(machine.link.sessionId != null ? (ACCESS_NAME[liveRoles] || String(liveRoles)) : '--');
  const isConfigure = $derived(liveRoles >= ACCESS.configure);
  const canAdminister = $derived(adminEntry ? liveRoles >= (adminEntry.access | 0) : false);

  // 0x000A needs configure; a not-yet-paired session only has WELCOME/0x000B.
  const windowOpen = $derived(!!(sample && sample.flags_bits && sample.flags_bits.window_open) || liveWindowOpen);
  const windowText = $derived.by(() => {
    if (machine.link.phase !== 'live') return '--';
    if (!windowOpen) return 'closed';
    if (!windowOpenedAt) return 'open; the hub does not report when it closes';
    const left = LIMITS.pairing_window_default_s - Math.floor((now - windowOpenedAt) / 1000);
    return left > 0 ? 'open, about ' + left + ' s left (the ' + LIMITS.pairing_window_default_s + ' s default)'
      : 'open past the ' + LIMITS.pairing_window_default_s + ' s default; the hub closes it';
  });

  // push_to_pair is a WINDOW, so its bit follows `windowOpen`; the other two
  // modes are standing capability with WELCOME as their only source.
  const modesOffered = $derived(
    [PAIRING_MODE.knock_approve, PAIRING_MODE.pin_proof, PAIRING_MODE.push_to_pair]
      .filter((bit) => (bit === PAIRING_MODE.push_to_pair ? windowOpen : (pairingModes & bit) !== 0))
      .map((bit) => PAIRING_MODE_NAME[bit])
  );

  /** The op-select field and its option labels, read off the catalog. */
  const opField = $derived(adminEntry && adminEntry.schema
    ? adminEntry.schema.find((f) => f.options && f.options.length) : null);
  const opIndex = (label) => (opField && opField.options.indexOf(label)) ?? -1;

  // TODO(rfc-ph-vdk.7): session-admin's value keys are named in the registry
  // note but not registered as numbers, so this is a spec-core FIELD-name
  // lookup; the channel itself is bound by id above.
  const keyOf = (name) => {
    const f = adminEntry && adminEntry.schema ? adminEntry.schema.find((x) => x.name === name) : null;
    return f ? f.key : null;
  };

  // ---- the pending list: fixed rows, pairing_pending_max of them ---------------
  const SLOTS = LIMITS.pairing_pending_max;
  const knocks = $derived.by(() => {
    const out = Array.from({ length: SLOTS }, (_, slot) => ({ slot, empty: true }));
    if (!sample) return out;
    const age = Math.max(0, Math.floor((now - (machine.sampleTs[pendingEntry.id] || now)) / 1000));
    for (let i = 0; i < Math.min(sample.count | 0, SLOTS); i++) {
      const lo = sample['inst_lo' + i], hi = sample['inst_hi' + i];
      if (lo === undefined || hi === undefined) break;
      out[i] = {
        slot: i, lo, hi,
        name: sample['name' + i] || '(unnamed client)',
        how: PAIRING_MODE_NAME[sample['kind' + i]] || 'unknown mode',
        left: Math.max(0, (sample['expires_s' + i] | 0) - age),
      };
    }
    return out;
  });
  const waiting = $derived(knocks.filter((k) => !k.empty).length);

  // ---- admin ops: one shadow (0x0009 op), one ladder, shown where it was asked
  const adminAction = $derived(adminEntry ? { channelId: adminEntry.id, key: keyOf('op'), label: 'session admin', widget: WIDGET.action } : null);
  const adminShadow = $derived(adminAction ? shadowOf(adminAction) : null);
  const adminStatus = $derived(adminAction ? statusOf(adminAction) : 'confirmed');
  const adminBusy = $derived(adminStatus === 'pending' || adminStatus === 'overdue');
  let lastOp = $state(null); // {where: 'knock'|'evict', verb, done, who}

  function ladder(where, idle) {
    if (!lastOp || lastOp.where !== where) return { phase: null, text: idle };
    if (lastOp.local) return { phase: 'fault', text: lastOp.local };
    if (adminStatus === 'pending') return { phase: 'pending', text: lastOp.verb + ' ' + lastOp.who + ': waiting for the hub' };
    if (adminStatus === 'overdue') return { phase: 'overdue', text: lastOp.verb + ' ' + lastOp.who + ': still waiting for the hub' };
    if (adminStatus === 'fault') return { phase: 'fault', text: 'Refused: ' + ((adminShadow && adminShadow.error) || 'no reason given') };
    return { phase: 'settled', text: lastOp.done + ' ' + lastOp.who + '.' };
  }

  /** instance_id travels as an 8-byte bstr; the layout splits it into two u32s. */
  function instanceBytes(k) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setUint32(0, k.lo >>> 0, true);
    new DataView(b.buffer).setUint32(4, k.hi >>> 0, true);
    return b;
  }

  async function decide(k, approve) {
    if (!getSession() || !adminAction) return;
    const op = opIndex(approve ? 'pair_approve' : 'pair_deny');
    const verb = approve ? 'Approving' : 'Denying';
    if (op < 0) { lastOp = { where: 'knock', local: 'This hub does not offer that operation.' }; return; }
    lastOp = { where: 'knock', verb, done: approve ? 'Approved' : 'Denied', who: k.name };
    // Approving at `control` lets a client drive the machine without letting
    // it hand out credentials. instance_id and role ride the op's own intent.
    const extra = { [keyOf('instance_id')]: instanceBytes(k) };
    if (approve) extra[keyOf('role')] = ACCESS.control;
    await runAction(adminAction, op, extra);
  }

  async function evict(sessionId) {
    if (!getSession() || !adminAction) return;
    const op = opIndex('evict');
    if (op < 0) { lastOp = { where: 'evict', local: 'This hub does not offer eviction.' }; return; }
    lastOp = { where: 'evict', verb: 'Evicting', done: 'Evicted', who: 'session ' + sessionId };
    await runAction(adminAction, op, { [keyOf('session_id')]: sessionId });
  }

  const knockLadder = $derived(ladder('knock', !pendingEntry || !adminEntry ? 'This hub does not advertise a pairing surface.'
    : !canAdminister ? 'Approving other clients needs configure; this session is at ' + tierName + '.'
    : waiting ? 'Approve grants control; Deny drops the knock.'
    : 'Nobody is waiting. A knock appears in the first free row and stays for its window.'));

  // ---- this client's OWN knock ------------------------------------------------
  const CLAIM_MS = (LIMITS.pairing_window_default_s + 5) * 1000;
  let claiming = $state(false);
  let claimDeadline = $state(0);
  let claimResult = $state(null); // {phase, msg}
  let claimTimer = null;

  function ownKnockEvent(evt) {
    const id = evt.body && evt.body.instance_id;
    return id instanceof Uint8Array && bytesEqual(id, getInstanceId());
  }
  function finishClaim(phase, msg) {
    claiming = false;
    clearTimeout(claimTimer);
    claimTimer = null;
    claimResult = { phase, msg };
  }
  function onPairingEvent(evt) {
    if (!claiming || !ownKnockEvent(evt)) return;
    if (evt.kind === PAIRING_EVENT_KIND.knocked) claimResult = { phase: 'pending', msg: 'Knock delivered: waiting for an operator to approve it' };
    else if (evt.kind === PAIRING_EVENT_KIND.denied) finishClaim('fault', 'Denied by an operator.');
    else if (evt.kind === PAIRING_EVENT_KIND.expired) finishClaim('fault', 'The knock expired unanswered.');
  }
  function onPairingNack(n) {
    if (!claiming) return;
    finishClaim('fault', n.code === NACK.PAIRING_REQUIRED
      ? 'Refused: knock-and-approve is off on this hub and no pairing window is open.'
      : n.code === NACK.BUSY ? 'Refused: the pending list is full. Try again shortly.'
        : 'Refused: ' + n.name + (n.detail ? ', ' + n.detail : ''));
  }
  function onPairGrant(g) {
    if (g.token) setPairedToken(getSession().host, g.token);
    const roleName = g.role != null ? (ACCESS_NAME[g.role] || String(g.role)) : 'a higher tier';
    finishClaim('settled', 'Paired at ' + roleName + '. This browser uses it from now on, reloads included.');
  }
  function startClaim() {
    const s = getSession();
    if (!s) return;
    if (!s.sendPairReq()) { finishClaim('fault', 'Not connected yet. Try again once the link is live.'); return; }
    claiming = true;
    claimDeadline = Date.now() + CLAIM_MS;
    claimResult = { phase: 'pending', msg: 'Knock sent: waiting for the hub' };
    clearTimeout(claimTimer);
    claimTimer = setTimeout(() => {
      if (claiming) finishClaim('fault', 'No answer within the pairing window: nobody approved it, or no window was open.');
    }, CLAIM_MS);
  }
  const claimLadder = $derived.by(() => {
    if (isConfigure) return { phase: null, text: 'This session holds configure: nothing to claim.' };
    if (machine.link.phase !== 'live') return { phase: null, text: 'Connect to a hub to pair with it.' };
    if (!claimResult) return { phase: null, text: 'Knocks once. An operator with configure approves it, or an open window grants it at once.' };
    const left = Math.max(0, Math.ceil((claimDeadline - now) / 1000));
    return { phase: claimResult.phase, text: claimResult.msg + (claiming ? ', ' + left + ' s left.' : '') };
  });

  // ---- control ownership ----------------------------------------------------------
  // control-owner (0x0004) is spec-core and `watch`-visible: src0/owner0..src3/owner3.
  const ownerEntry = $derived(coreEntry(CORE_CHANNEL.control_owner));
  const ownerSample = $derived(ownerEntry ? machine.samples[ownerEntry.id] : null);
  const owners = $derived.by(() => {
    if (!ownerSample) return [];
    const out = [];
    for (let i = 0; i < 4; i++) {
      const src = ownerSample['src' + i], owner = ownerSample['owner' + i];
      if (src === undefined || owner === undefined) break;
      // Keyed by slot index: src is wire-reported and may repeat (ph-0pw).
      out.push({ i, src, owner });
    }
    return out;
  });
  const evictLadder = $derived(ladder('evict', canAdminister
    ? 'Evicting ends that session; its client may reconnect.' : 'Evicting needs configure.'));
</script>

<div class="pane-stack">
  <section class="pane-sec og-panel" aria-labelledby="pp-pairing">
    <div class="pane-head"><h2 id="pp-pairing">Pairing</h2></div>
    <dl class="pane-facts">
      <dt>This session</dt><dd>{tierName}</dd>
      <dt>Modes offered</dt><dd>{machine.link.phase !== 'live' ? '--' : modesOffered.length ? modesOffered.join(', ') : 'none advertised'}</dd>
      <dt>Pairing window</dt><dd class="window" class:open={windowOpen}>{windowText}</dd>
    </dl>
    <div class="row">
      <button type="button" class="og-btn" class:primary={!isConfigure} disabled={isConfigure || claiming || machine.link.phase !== 'live'}
              onclick={startClaim}>{claiming ? 'Waiting for an answer' : 'Pair this client'}</button>
      <button type="button" class="og-btn" disabled={!setupCat} title={setupCat ? '' : 'This hub advertises no setup settings'}
              onclick={() => (setupOpen = true)}>Set up this machine</button>
    </div>
    <p class="pane-status" role="status" data-phase={claimLadder.phase} title={claimLadder.text}>{claimLadder.text}</p>
    <details class="howto">
      <summary>Open a pairing window at the machine</summary>
      <ol>
        <li>Power the machine off and on three times in a row, each cycle within about 10 s of the previous boot.</li>
        <li>The third quick cycle opens a {LIMITS.pairing_window_default_s} s window and lights the pairing indicator.</li>
        <li>Once this page reconnects, press Pair this client inside the window.</li>
      </ol>
      <p class="pane-note">On a machine nobody has claimed, that knock becomes configure: holding the power cord is ownership. On a claimed machine it grants control, and configure needs an existing configure session to approve the knock.</p>
    </details>
  </section>
  {#if setupOpen && setupCat}<ProvisionWizard category={setupCat} onclose={() => (setupOpen = false)} />{/if}

  <section class="pane-sec og-panel" aria-labelledby="pp-knocks">
    <div class="pane-head">
      <h2 id="pp-knocks">Pending knocks</h2>
      <span class="count mono">{canAdminister ? waiting + ' of ' + SLOTS : '--'}</span>
    </div>
    <ul class="pane-list knocks">
      {#each knocks as k (k.slot)}
        {#if k.empty}
          <li class="vacant"><span class="slot mono">{k.slot}</span><span class="who">{canAdminister ? 'free' : 'locked'}</span></li>
        {:else}
          <li data-shadow={adminBusy && lastOp?.who === k.name ? adminStatus : null}>
            <span class="slot mono">{k.slot}</span>
            <span class="who" title={k.name + ', ' + k.how + ', expires in ' + k.left + ' s'}><span class="name">{k.name}</span><span class="meta">{k.how}, expires in {k.left} s</span></span>
            <span class="acts">
              <button type="button" class="og-btn sm" disabled={adminBusy || !canAdminister} onclick={() => decide(k, false)}>Deny</button>
              <button type="button" class="og-btn sm primary" disabled={adminBusy || !canAdminister} onclick={() => decide(k, true)}>Approve</button>
            </span>
          </li>
        {/if}
      {/each}
    </ul>
    <p class="pane-status" role="status" data-phase={knockLadder.phase} title={knockLadder.text}>{knockLadder.text}</p>
  </section>

  <section class="pane-sec og-panel" aria-labelledby="pp-ledger">
    <div class="pane-head"><h2 id="pp-ledger">Trust ledger</h2></div>
    {#if ledgerEntry}
      <Roster store={ledgerEntry} roster={ledgerRoster} />
      <p class="pane-note">Clients this hub has paired, one per slot. Revoking one is not offered here yet.</p>
    {:else}
      <p class="pane-empty">This hub does not publish a trust ledger, so its paired clients cannot be listed.</p>
    {/if}
  </section>

  {#if ownerEntry}
    <section class="pane-sec og-panel" aria-labelledby="pp-owners">
      <div class="pane-head"><h2 id="pp-owners">Control ownership</h2></div>
      {#if !owners.length}
        <p class="pane-empty">No motion source has reported an owner yet. Sources list here once the hub publishes them.</p>
      {:else}
        <ul class="pane-list">
          {#each owners as o (o.i)}
            <li>
              <span class="src mono">source {o.src}</span>
              <span class="who">
                {#if o.owner}
                  <span class="mono">session {o.owner}</span>
                  {#if o.owner === machine.link.sessionId}<span class="you">this session</span>{/if}
                {:else}
                  <span class="meta">unowned</span>
                {/if}
              </span>
              <span class="acts">
                <button type="button" class="og-btn sm" disabled={!o.owner || !canAdminister || adminBusy}
                        title={!canAdminister ? 'Evicting needs configure' : ''} onclick={() => evict(o.owner)}>Evict</button>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
      <p class="pane-status" role="status" data-phase={evictLadder.phase} title={evictLadder.text}>{evictLadder.text}</p>
    </section>
  {/if}
</div>

<style>
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  .window.open { color: var(--reality); }
  .count { font-size: .75rem; color: var(--tx-mut); }
  .slot { color: var(--tx-ghost); min-width: 2ch; }
  /* Every knock row is the same two-line box, occupied or free: a knock
     arriving never changes the list's height (the fixed-slot rule). */
  .knocks > li { display: grid; grid-template-columns: 2ch minmax(0, 1fr) auto; min-height: 58px; }
  .knocks .who { display: flex; flex-direction: column; }
  .knocks .who > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who { flex: 1 1 14ch; min-width: 0; overflow-wrap: anywhere; }
  .name { font-weight: 500; }
  .meta { color: var(--tx-mut); font-size: .75rem; }
  .src { color: var(--ink-dim); min-width: 9ch; }
  .acts { display: flex; gap: 8px; margin-left: auto; }
  .acts button { min-width: 80px; }
  .you { font-size: .7rem; color: var(--reality); border: 1px solid var(--reality); border-radius: var(--r-s); padding: 0 6px; margin-left: 6px; }
  .howto { font-size: .78rem; color: var(--ink-dim); }
  .howto summary { cursor: pointer; color: var(--ink); min-height: 30px; display: flex; align-items: center; }
  .howto ol { margin: .4rem 0 .4rem 1.1rem; padding: 0; max-width: 75ch; }
  .howto li + li { margin-top: .25rem; }
  @media (pointer: coarse) { .howto summary { min-height: 40px; } }
</style>
