/**
 * identity.js -- a control's stable identity and its Valence path
 * (docs/PLUGINS.md, Identities and paths): what the context menu hands a
 * plugin, what api.ui.field/module mount, and what Copy path writes.
 *
 * Constraints:
 * - An identity is the builder's placement key (settings.js controlKey, DESIGN
 *   10.2, law 10): a role when the field has one, else its uid. It never names
 *   a category, card or position, so it survives a catalog etag change while
 *   the control still exists, and a key the catalog lacks resolves to null.
 * - Plain JS over the settings model: no Svelte, no DOM, so node tests drive it.
 */
import { controlKey, placeableControls, surfacedFields, WIDGET } from './settings.js';
import { withoutClaimed } from './roles.js';
import { labelFor } from './format.js';

export const PATH_SCHEME = 'valence://';

/** The Valence path of `key` on hub `hub` (prefs.js hubKey). */
export const pathOf = (hub, key) => PATH_SCHEME + hub + '/' + key;

/** {hub, key} from a Valence path, or null. The hub ends at the first slash; the key keeps any later one. */
export function parsePath(text) {
  const s = String(text ?? '').trim();
  if (!s.startsWith(PATH_SCHEME)) return null;
  const rest = s.slice(PATH_SCHEME.length), i = rest.indexOf('/');
  return i > 0 && i < rest.length - 1 ? { hub: rest.slice(0, i), key: rest.slice(i + 1) } : null;
}

/** The field drawn with `uid` (a merged range's `lo+hi` included), or null. */
export function fieldByUid(model, uid) {
  if (!model || !uid) return null;
  const all = [...model.fields, ...model.actions, ...model.categories.flatMap((c) => c.groups.flatMap((g) => g.fields))];
  return all.find((f) => f.uid === uid) || null;
}

/** A field's identity. */
export const fieldKey = (model, f) => controlKey(f, model.byRole);

/** The identities of a field's real parts: a range's two, a color's three, else its own. */
export const partKeys = (model, f) => (f.lo ? [f.lo, f.hi] : f.r ? [f.r, f.g, f.b] : [f]).map((p) => fieldKey(model, p));

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const GROUP_RE = /^(group|diag):([^:]+):(.*)$/;

/**
 * What `key` draws on this model, or null when the catalog lacks it:
 *   {kind: 'field', control, title}       one placeable field (settings.js placeableControls)
 *   {kind: 'composite'|'plugin'|'safety', control, title}
 *   {kind: 'fields', fields, title}       a category page's card, or a Dash summary of fields
 *   {kind: 'telemetry', title}
 * `heroes` is heroes.js heroClaims' result; `safety` machine.svelte.js specSafetyAction().
 * A Dash duplicate (`<key>#<n>`) is its control.
 */
export function resolveIdentity(model, heroes, key, safety = null) {
  if (!model || typeof key !== 'string' || !key) return null;
  const base = key.replace(/#\d+$/, '');
  const claimed = (heroes && heroes.claimed) || new Set();
  if (base === 'widget:telemetry') return { kind: 'telemetry', title: 'Telemetry' };
  if (base === 'widget:hero-rank') {
    const fields = surfacedFields(model.fields, claimed, 'full');
    return fields.length ? { kind: 'fields', fields, title: 'Machine' } : null;
  }
  const loose = () => model.looseActions.filter((a) => !claimed.has(a.uid));
  if (base === 'widget:actions') return loose().length ? { kind: 'fields', fields: loose(), title: 'Actions' } : null;
  const g = GROUP_RE.exec(base);
  if (g) {
    const cat = withoutClaimed(model.categories, claimed).find((c) => String(c.id) === g[2]);
    const grp = cat && cat.groups.find((x) => !!x.diagnostic === (g[1] === 'diag') && (x.name || 'ungrouped') === g[3]);
    if (grp) return { kind: 'fields', fields: grp.fields, title: grp.title || (grp.diagnostic ? 'Diagnostics' : 'Settings') };
    // App.svelte's `other` page carries the loose actions as a card of its own.
    return g[1] === 'group' && g[3] === 'Actions' && loose().length ? { kind: 'fields', fields: loose(), title: 'Actions' } : null;
  }
  // A half of a merged pair is no placeable control, yet it stays a field with an identity of its own.
  const c = placeableControls(model, { heroes: (heroes && heroes.widgets) || [], safety })
    .find((x) => x.key === base || x.alias === base)
    || [...model.fields, ...model.actions].filter((f) => fieldKey(model, f) === base).map((field) => ({ key: base, kind: 'field', field }))[0];
  if (!c) return null;
  const title = c.kind === 'field' ? labelFor(c.field)
    : c.kind === 'safety' ? (c.key === 'safety:pause' ? 'Pause' : 'Stop')
    : c.hero.title || cap(c.hero.id);
  return { kind: c.kind, control: c, title };
}

/**
 * The value Paste value writes into `f` from clipboard text, or undefined when
 * it does not fit: a number inside the field's bounds, an option's index, any
 * text for a text field. A secret never pastes.
 */
export function pasteValue(f, text) {
  const s = String(text ?? '').trim();
  if (!f || !s || f.widget === WIDGET.secret) return undefined;
  if (f.widget === WIDGET.text) return s;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  if (f.options) return Number.isInteger(n) && f.options[n] != null ? n : undefined;
  return (typeof f.min === 'number' && n < f.min) || (typeof f.max === 'number' && n > f.max) ? undefined : n;
}

/** The identities of the fields a resolved module draws (a hero's claimed ones, a card's), for the node editor. */
export function fieldKeysOf(model, found) {
  if (!model || !found) return [];
  const keys = (list) => list.filter((f) => f.widget !== WIDGET.action).flatMap((f) => partKeys(model, f));
  if (found.kind === 'field') return keys([found.control.field]);
  if (found.kind === 'fields') return keys(found.fields);
  const uids = found.control && found.control.hero && found.control.hero.fields && found.control.hero.fields.claimed;
  return uids ? keys(model.fields.filter((f) => uids.has(f.uid))) : [];
}
