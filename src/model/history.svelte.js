/**
 * history.svelte.js -- 256 setting writes this session made, undoable, and
 * Revert changes to the connect-time baseline (DESIGN §10.13).
 *
 * Constraints:
 * - Undo, redo and revert are machine writes: they go through writeSetting and
 *   the confirm gate a user's edit takes, so the four-state ladder and NACK
 *   handling apply unchanged. History records on the settle hook only.
 * - Revert skips every hazard write (needs a confirm, destructive, a run
 *   switch, a secret) and names it; a refused write is reported, never retried.
 * - Baseline: the reported values when the link goes live, a field first
 *   written after that adds its own before. Cleared with the history when the
 *   link ends (idle or failed), kept through a retry.
 */
import { untrack } from 'svelte';
import { FIELD_ROLE } from '../../../Valence/clients/js/index.js';
import { machine } from './machine.svelte.js';
import { writeSetting, setSettledHook, shadowOf, displayValue, STATUS } from './shadow.svelte.js';
import { reportedValue, isFieldEnabled } from './settings.js';
import { settingNeedsConfirm, confirmCopy } from './actions.js';
import { labelFor } from './format.js';
import { askConfirm } from '../ui/confirm.svelte.js';
import { pushEntry, planRevert, fillBaseline, MAX } from './history.js';

export { MAX };

/** entries: oldest first. redo: the undone ones, newest undo last. msg: the one status line. */
export const history = $state({ entries: [], redo: [], msg: '', busy: false, baselined: false });

let baseline = null;
let nextId = 1;
let fillTimer = null;
const fieldOf = new Map();   // entry id -> the field written; a catalog rebuild never strands an entry

const RUN_ROLES = new Set([FIELD_ROLE.pattern_running, FIELD_ROLE.advgen_running]);
const isSecret = (f) => !!(f.flagBits && f.flagBits.secret);
const settings = () => ((machine.catalog.model && machine.catalog.model.fields) || [])
  .filter((f) => !f.readOnly && f.writeChannel != null && f.settingKey != null && !isSecret(f));
const hazard = (f, from, to) => RUN_ROLES.has(f.role) || settingNeedsConfirm(f, from, to);
const currentOf = (f) => reportedValue(f, machine.samples[f.channelId]);

/** Why a write would not leave right now; '' when it would. */
function whyNot(f) {
  if (machine.link.phase !== 'live') return 'no hub link';
  const e = machine.catalog.entries.find((x) => x.id === f.writeChannel);
  if (!e || (machine.link.roles | 0) < (e.access | 0)) return 'session not authorized';
  if (!isFieldEnabled(f, machine.samples[f.channelId])) return 'disabled by the machine';
  return '';
}

const fill = () => {
  baseline = fillBaseline(baseline, settings().map((f) => ({ uid: f.uid, cur: currentOf(f) })));
  history.baselined = true;
};

function onSettled({ field, before, after, trial, via, id }) {
  if (isSecret(field)) return;
  if (via === 'undo' || via === 'redo') {
    const [from, to] = via === 'undo' ? [history.entries, history.redo] : [history.redo, history.entries];
    const i = from.findIndex((e) => e.id === id);
    if (i >= 0) to.push(...from.splice(i, 1));
    return;
  }
  if (baseline && before !== undefined && !(field.uid in baseline)) baseline[field.uid] = before;
  history.redo.length = 0;
  const e = pushEntry(history.entries, { id: nextId, uid: field.uid, label: labelFor(field), before, after, t: Date.now(), trial: !!trial });
  if (e) { fieldOf.set(e.id, field); if (e.id === nextId) nextId++; }
  const kept = new Set([...history.entries, ...history.redo].map((x) => x.id));
  for (const k of fieldOf.keys()) if (!kept.has(k)) fieldOf.delete(k);
}
setSettledHook(onSettled);

/** The write's shadow once it leaves pending, or whatever it holds after 3.2 s. */
async function outcome(field) {
  for (let i = 0; i < 80; i++) {
    const sh = shadowOf(field);
    if (sh && sh.status !== STATUS.pending && sh.status !== STATUS.overdue) return sh;
    await new Promise((r) => setTimeout(r, 40));
  }
  return shadowOf(field);
}

async function replay(e, via) {
  const f = fieldOf.get(e.id);
  const why = f ? whyNot(f) : 'not in this catalog';
  if (why) { history.msg = e.label + ': ' + why; return false; }
  const to = via === 'undo' ? e.before : e.after;
  const from = displayValue(f, machine.samples[f.channelId]);
  if (settingNeedsConfirm(f, from, to) && !(await askConfirm(confirmCopy(f)))) return false;
  writeSetting(f, to, { trial: e.trial, hist: { via, id: e.id } });
  const sh = await outcome(f);
  if (sh && sh.status === STATUS.fault) { history.msg = e.label + ': ' + sh.error; return false; }
  history.msg = '';
  return true;
}

// One replay at a time: a second Ctrl+Z before the first echo would undo the same entry twice.
const once = (fn) => async (...a) => {
  if (history.busy) return false;
  history.busy = true;
  try { return await fn(...a); } finally { history.busy = false; }
};

/** Undo the newest entry, or entry `id`. */
export const undo = once((id) => {
  const e = id == null ? history.entries[history.entries.length - 1] : history.entries.find((x) => x.id === id);
  return e ? replay(e, 'undo') : false;
});

export const redo = once(() => {
  const e = history.redo[history.redo.length - 1];
  return e ? replay(e, 'redo') : false;
});

const revertItems = () => settings().map((f) => {
  const cur = currentOf(f);
  return { f, uid: f.uid, label: labelFor(f), cur, hazard: (to) => hazard(f, cur, to) };
});

/** The field an entry wrote, for formatting its values. */
export const fieldOfEntry = (id) => fieldOf.get(id);

/** How many settings Revert changes would write now (the confirm's count). */
export const revertCount = () => (baseline ? planRevert(baseline, revertItems()).send.length : 0);

/**
 * Write every changed, non-hazard setting back to its baseline value.
 * @returns {Promise<{sent: number, skipped: string[], refused: string[]} | null>} null without a baseline
 */
export const revertAll = once(async () => {
  if (!baseline) return null;
  const items = revertItems();
  const { send, skipped } = planRevert(baseline, items);
  const refused = [], sent = [];
  for (const s of send) {
    const f = items.find((i) => i.uid === s.uid).f, why = whyNot(f);
    if (why) { refused.push(labelFor(f) + ': ' + why); continue; }
    writeSetting(f, s.to);
    sent.push(f);
  }
  let n = sent.length;
  for (const f of sent) {
    const sh = await outcome(f);
    if (sh && sh.status === STATUS.fault) { refused.push(labelFor(f) + ': ' + sh.error); n--; }
  }
  history.msg = [n ? 'Reverted ' + n : 'Nothing reverted', skipped.length && 'Skipped, needs a confirm: ' + skipped.join(', '),
    refused.length && 'Refused: ' + refused.join(', ')].filter(Boolean).join('. ');
  return { sent: n, skipped, refused };
});

$effect.root(() => {
  $effect(() => {
    const phase = machine.link.phase;
    untrack(() => {
      if (phase === 'live') {
        fill();
        clearTimeout(fillTimer);
        fillTimer = setTimeout(fill, 2000);
      } else if (phase === 'idle' || phase === 'failed') {
        baseline = null;
        history.baselined = false;
        clearTimeout(fillTimer);
        history.entries.length = 0;
        history.redo.length = 0;
        history.msg = '';
        fieldOf.clear();
      }
    });
  });
});

// Ctrl+Z / Ctrl+Shift+Z: not in a text field or an editor that owns its undo.
// Those handle the key and preventDefault, so the check runs after them.
function onKey(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'z') return;
  setTimeout(() => {
    if (e.defaultPrevented || document.querySelector('.edit-ops')) return;
    const t = e.target;
    if (t && t.closest && t.closest('textarea, [contenteditable]:not([contenteditable=false]), input:not([type=range],[type=checkbox],[type=radio],[type=button])')) return;
    (e.shiftKey ? redo : undo)();
  });
}
if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);
