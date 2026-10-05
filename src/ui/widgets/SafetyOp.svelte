<script>
  /**
   * SafetyOp.svelte: one safety pair as ONE two-state control (RENDERING
   * law 14): the top strip's fixed pair, its override/return while a rail is
   * mounted, and every placed copy (DESIGN §10.3).
   *
   * Constraints:
   * - `op` is the pair's first op: SAFETY_OP.estop (estop/release),
   *   SAFETY_OP.pause (pause/resume) or SAFETY_OP.override (override/return).
   *   The state is the hub's latched snapshot, never this press: a control
   *   that flipped on its own press would lie (law 4).
   * - Override confirms first (actions.js HAZARD_SAFETY_OPS: it lifts the
   *   window and soft limits); return takes no gate.
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
   * - FIXED BOX in both states (ph-e82.21): hidden ghosts size the button to
   *   its widest label and standing subline; the live status line never adds
   *   width (it ellipsizes, the title carries it). A pending press once
   *   widened Pause for one frame and shifted the whole strip.
   * - The subline carries live state only (docs/COPY.md rule 5); what a
   *   press does is the tooltip. Override and Return carry neither
   *   (operator 2026-10-02).
   * - The ladder wears the fields' ring (docs/EFFECTS.md A: `.field` in
   *   style.css), 3 px outside the box, with the echo's afterglow; never the
   *   inset ring, which shrank the box's face (ph-vdk.65).
   */
  import { machine, getSession, estopLabel } from '../../model/machine.svelte.js';
  import { runAction } from '../../model/shadow.svelte.js';
  import { needsConfirm } from '../../model/actions.js';
  import { askConfirm } from '../confirm.svelte.js';
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
  // Override lifts the window: two arrows inside its sides pointing out.
  // Return closes it: two arrows outside pointing in. The window is two
  // vertical lines, no top or bottom (operator 2026-10-05).
  const ARROW = {
    override: '<path d="M3 5v14M21 5v14M11 12H6M8.5 9.5L6 12l2.5 2.5M13 12h5M15.5 9.5L18 12l-2.5 2.5"/>',
    return: '<path d="M10 6v12M14 6v12M2 12h5M4.5 9.5L7 12l-2.5 2.5M22 12h-5M19.5 9.5L17 12l2.5 2.5"/>',
  };
  // Per pair: the snapshot bit that is its second state, and its second op.
  const PAIR = {
    [SAFETY_OP.estop]: { bit: 'estopLatched', second: SAFETY_OP.release, cls: 'btn-estop' },
    [SAFETY_OP.pause]: { bit: 'paused', second: SAFETY_OP.resume, cls: 'btn-pause' },
    [SAFETY_OP.override]: { bit: 'override', second: SAFETY_OP.return_op, cls: 'btn-override' },
  };
  const OVERRIDE_COPY = {
    title: 'Override',
    body: 'Lifts the window and soft limits until Return',
    confirmLabel: 'Override',
  };

  const pair = $derived(PAIR[op]);
  const isEstop = $derived(op === SAFETY_OP.estop);
  const latch = $derived(machine.safety);
  const latched = $derived(!!latch && latch[pair.bit]);
  // The op a press (or a full hold) sends right now.
  const send = $derived(latched ? pair.second : op);
  // [first state, second state]. TIPS: what a press does. STANDING: the
  // second state's own subline, the one a release or resume waits on.
  const isOverride = $derived(op === SAFETY_OP.override);
  const LABELS = $derived(isEstop ? [estopLabel(), 'Halted'] : isOverride ? ['Override', 'Return'] : ['Pause', 'Resume']);
  const TIPS = $derived(isEstop ? [estopLabel() === 'E-Stop' ? 'Cut motor power' : 'Stop motion', 'Hold 3 s to release']
    : isOverride ? [] : ['Hold position', 'Continue motion']);
  const STANDING = $derived(isEstop ? ['Hold 3 s'] : isOverride ? [] : ['home required']);
  const label = $derived(LABELS[latched ? 1 : 0]);
  const tip = $derived(TIPS[latched ? 1 : 0] || '');
  const hint = $derived(!latched ? '' : isEstop ? STANDING[0] : !isOverride && latch.homeRequired ? STANDING[0] : '');
  const icon = $derived(isEstop ? 'estop' : op === SAFETY_OP.override ? (latched ? 'return' : 'override')
    : latched ? 'resume' : 'pause');

  const why = $derived.by(() => {
    void machine.link.roles; void machine.catalog.ready;
    if (machine.link.phase !== 'live') return 'no hub link';
    if (!action) return machine.catalog.ready ? 'no safety intents on this hub' : 'no catalog yet';
    if (!(action.options || [])[send]) return 'no ' + SAFETY_OP_NAME[send] + ' op on this hub';
    const s = getSession();
    return s && s.canUse(action.channelId, action.key, send) ? '' : 'session not authorized';
  });

  let phase = $state('');   // '' | pending | overdue | confirmed | fault
  let error = $state('');
  // The afterglow: 1 and 2 alternate per echo so a fast echo still restarts
  // it; a press puts it out; its own animationend ends it.
  let glow = $state(0);
  let lastGlow = 0;
  const glowEnd = (e) => { if (e.target === e.currentTarget && e.animationName.startsWith('fx-glow')) glow = 0; };
  async function fire(value) {
    if (why || phase === 'pending' || phase === 'overdue') return;
    if (needsConfirm(action, value) && !(await askConfirm(OVERRIDE_COPY))) return;
    phase = 'pending';
    glow = 0;
    const t = setTimeout(() => { if (phase === 'pending') phase = 'overdue'; }, OVERDUE_MS);
    const r = await runAction(action, value);
    clearTimeout(t);
    phase = r.ok ? 'confirmed' : 'fault';
    error = r.error || '';
    if (r.ok) glow = lastGlow = lastGlow === 1 ? 2 : 1;
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
    holding ? 'Keep holding'
    : phase === 'pending' ? 'Waiting'
    : phase === 'overdue' ? 'Still waiting'
    : phase === 'fault' ? error
    : why || hint
  );
</script>

<div class="safety-op field" data-shadow={phase === 'confirmed' || !phase ? 'confirmed' : phase} data-glow={glow || undefined}
     onanimationend={glowEnd}>
  <button type="button" class="btn {pair.cls}" class:latched class:holding
          disabled={!!why} title={status && status !== hint ? status : tip || undefined} aria-pressed={latched}
          {onclick} {onkeydown} {onkeyup}
          onpointerdown={pressStart} onpointerup={holdEnd} onpointerleave={holdEnd} onpointercancel={holdEnd}
          oncontextmenu={(e) => { if (isEstop && latched) e.preventDefault(); }}>
    <span class="row">
      <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true">{@html isOverride ? ARROW[icon] : ICON[icon]}</svg>
      <span class="lbls"><span class="lbl">{label}</span><span class="ghost" aria-hidden="true">{LABELS[latched ? 0 : 1]}</span></span>
    </span>
    <small class="state" class:hint={status === hint} role="status">{status}</small>
    <span class="hints ghost" aria-hidden="true">{#each STANDING as h}<small>{h}</small>{/each}</span>
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
    justify-content: flex-start;
    min-height: var(--tap);
    min-width: var(--sb-w, max(var(--tap), 96px));
    width: var(--sb-w, auto);
    height: var(--sb-h, auto);
    padding: 4px 8px 2px;
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
  /* Narrower than the strip's pair at 96px (2 x 96 + 6 + 2 x --gap): the
     op sheds the 96px floor and its text wraps; --tap still holds. */
  @media (max-width: 221px) {
    .btn { min-width: var(--tap); padding: 2px 6px; white-space: normal; }
  }
  .btn:disabled { opacity: .4; }
  .btn:not(:disabled):hover { border-color: var(--line-4); }
  /* Icon above the word; the live subline sits below and never moves them. */
  .row { display: flex; flex-direction: column; align-items: center; gap: 1px; }
  /* The strip's one icon box and drawn stroke (TopStrip.svelte). */
  .ico { width: var(--sico, 28px); height: var(--sico, 28px); }
  .ico :global(*) { vector-effect: non-scaling-stroke; }
  .lbls, .hints { display: grid; }
  .lbls > *, .hints > * { grid-area: 1 / 1; }
  .ghost { visibility: hidden; }
  .hints { height: 0; overflow: hidden; }
  .state, .hints small { font-size: max(11px, .56rem); color: var(--tx-mut); font-weight: 400; }
  /* Never widens the box: no intrinsic width, stretched to the button. */
  .state { contain: inline-size; align-self: stretch; min-height: 1.2em; overflow: hidden; text-overflow: ellipsis; text-align: center; }
  [data-shadow='overdue'] .state { color: var(--warn-ink, var(--warn)); }
  [data-shadow='fault'] .state { color: var(--warn-ink, var(--warn)); }

  /* The e-stop's only hazard cue at rest is the stripe wash in the safety red
     (law 13: never themeable); latched it reads Halted on a solid border. */
  .btn-estop {
    background-image: repeating-linear-gradient(135deg, rgba(var(--bad-rgb), .09) 0 5px, rgba(var(--bad-rgb), .012) 5px 10px);
  }
  .btn-estop:not(:disabled):hover, .btn-estop:not(:disabled):active, .btn-estop.latched { border-color: var(--bad); }
  .btn-estop.latched .lbl { color: var(--bad); }
  .btn-pause.latched, .btn-override.latched { border-color: var(--warn); }

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
