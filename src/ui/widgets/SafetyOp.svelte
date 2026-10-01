<script>
  /**
   * SafetyOp.svelte: one safety op as a placeable module (DESIGN §10.3).
   *
   * Constraints:
   * - Bound by safety-intents identity (machine.svelte.js specSafetyAction,
   *   law 2), never by a role tag. The top strip's e-stop is not this module
   *   and never moves; this is an extra copy.
   * - Gated ops gray with their reason in words (law 3), never hide.
   * - The ladder is this press's own: one shadow record serves every op of
   *   the safety channel, so a sibling module's press must not light this one.
   */
  import { machine, getSession } from '../../model/machine.svelte.js';
  import { runAction } from '../../model/shadow.svelte.js';
  import { needsConfirm, confirmCopy } from '../../model/actions.js';
  import { optionLabel } from '../../model/format.js';
  import { SAFETY_OP } from '../../../../Valence/clients/js/index.js';
  import { askConfirm } from '../confirm.svelte.js';

  let { action, op } = $props();

  const OVERDUE_MS = 500;
  const label = $derived(optionLabel(action, op).replace(/_/g, ' '));
  const why = $derived.by(() => {
    void machine.link.roles;
    if (machine.link.phase !== 'live') return 'no hub link';
    const s = getSession();
    return s && s.canUse(action.channelId, action.key, op) ? '' : 'this session is not authorized for this op';
  });

  let phase = $state('');   // '' | pending | overdue | confirmed | fault
  let error = $state('');
  async function fire() {
    if (why || phase === 'pending' || phase === 'overdue') return;
    if (needsConfirm(action, op) && !(await askConfirm(confirmCopy(action, op)))) return;
    phase = 'pending';
    const t = setTimeout(() => { if (phase === 'pending') phase = 'overdue'; }, OVERDUE_MS);
    const r = await runAction(action, op);
    clearTimeout(t);
    phase = r.ok ? 'confirmed' : 'fault';
    error = r.error || '';
  }
  const text = $derived(
    phase === 'pending' ? 'waiting for the machine'
    : phase === 'overdue' ? 'still waiting for the machine'
    : phase === 'fault' ? 'refused: ' + error
    : phase === 'confirmed' ? 'confirmed'
    : why
  );
</script>

<div class="safety-op" data-shadow={phase === 'confirmed' || !phase ? 'confirmed' : phase}>
  <button type="button" class="btn" class:estop={op === SAFETY_OP.estop}
          disabled={!!why} title={why || label} onclick={fire}>{label}</button>
  <p class="state" role="status">{text}</p>
</div>

<style>
  .safety-op { display: flex; flex-direction: column; gap: 6px; height: 100%; }
  .btn { flex: 1 1 auto; min-height: var(--tap); text-transform: capitalize; }
  .btn.estop { border-color: var(--bad); color: var(--ink); }
  .state { margin: 0; min-height: 1.2em; font-size: .78rem; color: var(--ink-dim); }
  [data-shadow='overdue'] .state { color: var(--warn); }
  [data-shadow='fault'] .state { color: var(--bad); }
</style>
