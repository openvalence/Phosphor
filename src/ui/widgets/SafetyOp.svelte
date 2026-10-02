<script>
  /**
   * SafetyOp.svelte: one safety pair as ONE two-state control (RENDERING
   * law 14), the top strip's fixed pair and every placed copy (DESIGN §10.3).
   *
   * Constraints:
   * - `op` is SAFETY_OP.estop (estop/release) or SAFETY_OP.pause
   *   (pause/resume). The state is the hub's latched snapshot, never this
   *   press: a control that flipped on its own press would lie (law 4).
   * - Bound by safety-intents identity (machine.svelte.js specSafetyAction,
   *   law 2). `action` may be null (no link, no catalog): the control still
   *   renders, disabled with the reason, so the stop never appears later.
   * - Release is the latched e-stop held for RELEASE_HOLD_MS; a shorter hold
   *   sends nothing, so two panic taps never latch-then-release. Resume takes
   *   no gate and is only ever sent from a press here (SPEC §11.1).
   * - The label follows estop_cuts_power (law 15): never E-Stop on a hub that
   *   declared false or nothing.
   * - The ladder is this press's own: one shadow record serves every op of
   *   the safety channel, so a sibling copy's press must not light this one.
   */
  import { machine, getSession, estopLabel } from '../../model/machine.svelte.js';
  import { runAction } from '../../model/shadow.svelte.js';
  import { SAFETY_OP } from '../../../../Valence/clients/js/index.js';
  import { SAFETY_OP_NAME } from '../../../../Valence/clients/js/generated/registry_vocab.js';

  let { action = null, op } = $props();

  // RENDERING §8.4 `stop` row: RECOMMENDED 3 s, client vocabulary.
  const RELEASE_HOLD_MS = 3000;
  const OVERDUE_MS = 500;
  // Lucide (MIT) paths; the triangle and bars are the OG ui.js ICONS entries.
  const ICON = {
    estop: '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    resume: '<polygon points="6 4 20 12 6 20 6 4"/>',
  };

  const isEstop = $derived(op === SAFETY_OP.estop);
  const latch = $derived(machine.safety);
  const latched = $derived(!!latch && (isEstop ? latch.estopLatched : latch.paused));
  // The op a press (or a full hold) sends right now.
  const send = $derived(isEstop ? (latched ? SAFETY_OP.release : SAFETY_OP.estop)
    : (latched ? SAFETY_OP.resume : SAFETY_OP.pause));
  const label = $derived(isEstop ? (latched ? 'Halted' : estopLabel()) : (latched ? 'Resume' : 'Pause'));
  const hint = $derived(isEstop
    ? (latched ? 'hold 3 s to release' : estopLabel() === 'E-Stop' ? 'cut power' : 'stop motion')
    : (latched ? (latch.homeRequired ? 'home required' : 'paused') : 'hold position'));

  const why = $derived.by(() => {
    void machine.link.roles; void machine.catalog.ready;
    if (machine.link.phase !== 'live') return 'no hub link';
    if (!action) return machine.catalog.ready ? 'this hub advertises no safety intents' : 'no catalog yet';
    if (!(action.options || [])[send]) return 'this hub advertises no ' + SAFETY_OP_NAME[send] + ' op';
    const s = getSession();
    return s && s.canUse(action.channelId, action.key, send) ? '' : 'this session is not authorized for this op';
  });

  let phase = $state('');   // '' | pending | overdue | confirmed | fault
  let error = $state('');
  async function fire(value) {
    if (why || phase === 'pending' || phase === 'overdue') return;
    phase = 'pending';
    const t = setTimeout(() => { if (phase === 'pending') phase = 'overdue'; }, OVERDUE_MS);
    const r = await runAction(action, value);
    clearTimeout(t);
    phase = r.ok ? 'confirmed' : 'fault';
    error = r.error || '';
  }

  // ---- hold to release ------------------------------------------------------
  let holding = $state(false);
  let holdTimer = 0;
  // Was the e-stop latched when this press began? The click that ends a
  // completed release hold arrives after the latch has cleared; without this
  // it would read as a fresh tap and latch the e-stop again.
  let pressLatched = false;
  function pressStart() {
    pressLatched = isEstop && latched;
    if (!pressLatched || why || holding) return;
    holding = true;
    holdTimer = setTimeout(() => { holding = false; fire(SAFETY_OP.release); }, RELEASE_HOLD_MS);
  }
  function holdEnd() {
    clearTimeout(holdTimer);
    holding = false;
  }
  $effect(() => () => clearTimeout(holdTimer));

  // A tap latches estop, pauses or resumes. A tap on a latched e-stop does
  // nothing: release only ever comes from the hold above. pressLatched is
  // consumed here so a click with no press before it (assistive tech) is
  // judged on the latch alone and never swallows an e-stop.
  function onclick() {
    const began = pressLatched;
    pressLatched = false;
    if (isEstop && (began || latched)) return;
    fire(send);
  }
  function onkeydown(e) {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) pressStart();
    if ((e.key === 'Enter' || e.key === ' ') && pressLatched) e.preventDefault();
  }
  function onkeyup(e) {
    if (e.key === 'Enter' || e.key === ' ') holdEnd();
  }

  const status = $derived(
    holding ? 'keep holding to release'
    : phase === 'pending' ? 'waiting for the machine'
    : phase === 'overdue' ? 'still waiting for the machine'
    : phase === 'fault' ? 'refused: ' + error
    : why || hint
  );
</script>

<div class="safety-op" data-shadow={phase === 'confirmed' || !phase ? 'confirmed' : phase}>
  <button type="button" class="btn {isEstop ? 'btn-estop' : 'btn-pause'}" class:latched class:holding
          disabled={!!why} title={why || label} aria-pressed={latched}
          {onclick} {onkeydown} {onkeyup}
          onpointerdown={pressStart} onpointerup={holdEnd} onpointerleave={holdEnd} onpointercancel={holdEnd}
          oncontextmenu={(e) => { if (isEstop && latched) e.preventDefault(); }}>
    <span class="row">
      <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true">{@html ICON[isEstop ? 'estop' : latched ? 'resume' : 'pause']}</svg>
      <span class="lbl">{label}</span>
    </span>
    <small class="state" role="status">{status}</small>
    {#if holding}<span class="hold" aria-hidden="true" style="--hold-ms: {RELEASE_HOLD_MS}ms"></span>{/if}
  </button>
</div>

<style>
  .safety-op { display: flex; height: 100%; }
  /* Law 12: at least --tap in both axes at every pointer type. */
  .btn {
    position: relative;
    overflow: hidden;
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: var(--tap);
    min-width: max(var(--tap), 96px);
    padding: 2px 12px;
    background: transparent;
    border: 1px solid var(--line-2);
    border-radius: var(--r-s);
    color: var(--ink);
    font-weight: 500;
    font-size: .72rem;
    white-space: nowrap;
    user-select: none;
    -webkit-touch-callout: none;
    transition: border-color .12s, color .12s;
  }
  .btn:disabled { opacity: .4; }
  .btn:not(:disabled):hover { border-color: var(--line-4); }
  .row { display: flex; align-items: center; gap: 4px; }
  .ico { width: 14px; height: 14px; }
  .state { font-size: max(11px, .56rem); color: var(--tx-mut); font-weight: 400; }
  [data-shadow='overdue'] .state { color: var(--warn); }
  [data-shadow='fault'] .state { color: var(--bad); }

  /* The e-stop's only hazard cue at rest is the stripe wash in the safety red
     (law 13: never themeable); latched it reads Halted on a solid border. */
  .btn-estop {
    background-image: repeating-linear-gradient(135deg, rgba(255, 71, 87, .09) 0 5px, rgba(255, 71, 87, .012) 5px 10px);
  }
  .btn-estop:not(:disabled):hover, .btn-estop:not(:disabled):active, .btn-estop.latched { border-color: var(--bad); }
  .btn-estop.latched .lbl { color: var(--bad); }
  .btn-pause.latched { border-color: var(--warn); }

  .hold {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 3px;
    width: 100%;
    background: var(--bad);
    transform-origin: left;
    animation: hold-fill var(--hold-ms) linear forwards;
  }
  @keyframes hold-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }

  @media (prefers-reduced-motion: reduce) {
    .btn { transition: none; }
    .hold { animation: none; }
  }
</style>
