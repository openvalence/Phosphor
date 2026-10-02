<script>
  /**
   * Home.svelte: the home page (DESIGN §10.1). An ADDITIONAL surface: the
   * derived category pages keep every field reachable without it
   * (RENDERING §12), so nothing here is the only path to a field.
   *
   * Constraints:
   * - Membership is the key set of this view's placement map in the active
   *   layout, plus every nest's members. View id 'machine' is the map the
   *   migrated Default layout already holds (grid.js loadStore); never rename it.
   * - A map with no plain key is a home the user has not built: it shows the
   *   seed (rank-surfaced fields, telemetry, card-zone heroes, loose actions).
   *   BUILT keeps a home emptied by deletes from reseeding; the grid's Reset
   *   clears it, which reseeds.
   * - Keys the catalog no longer resolves stay in the map, inert (law 10). A
   *   role field's uid-form key is an alias of its role key (ph-e82.9). A
   *   `<key>#<n>` key is a second placement of the same control (Duplicate),
   *   with its own place and look; the palette counts the control once.
   * - Only the `full` class builds (ph-e82.7); other classes always show the seed.
   */
  import DashGrid from './dash/DashGrid.svelte';
  import Palette from './Palette.svelte';
  import Field from './Field.svelte';
  import ActionField from './ActionField.svelte';
  import Control from './widgets/Control.svelte';
  import LookEditor from './LookEditor.svelte';
  import TelemetryChart from './widgets/TelemetryChart.svelte';
  import { dashboardLayout, layouts, grid, checkpoint } from '../model/dashboard.svelte.js';
  import { viewMap, cellCount, isNest, placeable, instanceKey, baseKey } from '../model/grid.js';
  import { view } from '../model/viewport.svelte.js';
  import { specSafetyAction, estopLabel } from '../model/machine.svelte.js';
  import { SAFETY_OP } from '../../../Valence/clients/js/index.js';
  import { placeableControls, surfacedFields, minCells, WIDGET } from '../model/settings.js';
  import { labelFor } from '../model/format.js';

  let { model, heroes } = $props();

  const VIEW = 'machine';
  const BUILT = 'home:built';
  const builder = $derived(view.cls === 'full');
  const layout = $derived(dashboardLayout(VIEW, view.cls));
  let editing = $state(false);
  let width = $state(0);
  const cols = $derived(cellCount(width, grid.cell));

  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const KIND_SECTION = { composite: 'Composites', plugin: 'Plugin widgets', safety: 'Safety' };
  // The resize floor (DashGrid): a field by its placed presentation, a composite or safety op by its declared cells.
  const minOf = (c) => (look, o) => minCells(c.kind === 'field' ? (look && look.pres) || c.presentations[0] : c.cells, o);

  // Every module this catalog can place, in palette order: summaries,
  // composites, plugin widgets, safety, then fields by category.
  const modules = $derived.by(() => {
    const out = new Map();
    const put = (id, title, section, extra) => out.set(id, { id, title, section, snippet: body, ...extra });
    const rank = surfacedFields(model.fields, heroes.claimed, view.cls);
    if (rank.length) put('widget:hero-rank', 'Machine', 'Summaries', { kind: 'module', fields: rank });
    put('widget:telemetry', 'Telemetry', 'Summaries', { kind: 'module', telemetry: true });
    const loose = model.looseActions.filter((a) => !heroes.claimed.has(a.uid));
    if (loose.length) put('widget:actions', 'Actions', 'Summaries', { kind: 'module', fields: loose });

    const catOf = new Map();
    for (const c of model.categories) for (const g of c.groups) for (const f of g.fields) catOf.set(f.uid, c.label);
    const controls = placeableControls(model, { heroes: heroes.widgets, safety: specSafetyAction() });
    for (const k of ['composite', 'plugin', 'safety']) {
      for (const c of controls.filter((x) => x.kind === k)) {
        put(c.key, k === 'safety' ? (c.op === SAFETY_OP.estop ? estopLabel() : 'Pause') : c.hero.title || cap(c.hero.id),
          KIND_SECTION[k], { kind: k, control: c, min: minOf(c) });
      }
    }
    const fields = controls.filter((x) => x.kind === 'field');
    for (const sec of [...model.categories.map((c) => c.label), 'Other fields']) {
      for (const c of fields.filter((x) => (catOf.get(x.field.uid) || 'Other fields') === sec)) {
        put(c.key, labelFor(c.field), sec, { kind: 'field', control: c, fields: [c.field], min: minOf(c) });
      }
    }
    return out;
  });

  // The seed, in order: rank surfacing (RENDERING §4, ph-vdk.36), telemetry,
  // card-zone heroes, loose actions.
  const seed = $derived([
    'widget:hero-rank', 'widget:telemetry',
    ...heroes.widgets.filter((h) => h.zone === 'card').map((h) => 'hero:' + h.id),
    'widget:actions',
  ]);

  const keys = $derived.by(() => {
    if (!builder) return seed;
    const m = viewMap(layouts, view.cls, VIEW, false);
    const plain = Object.keys(m).filter((k) => !isNest(m[k]));
    const nested = layout.nests().flatMap((n) => n.keys);
    return [...new Set([...(plain.length ? plain : seed), ...nested])];
  });
  // Homes saved before ph-e82.9 key role fields by uid: both forms resolve to
  // one control, which keeps the saved key as its id (its placement entry).
  const aliases = $derived(new Map([...modules.values()].filter((m) => m.control && m.control.alias)
    .map((m) => [m.control.alias, m.id])));
  const canon = (k) => { const b = baseKey(k); return aliases.get(b) || b; };
  const items = $derived(keys.filter((k) => modules.has(canon(k)))
    .map((k) => (k === canon(k) ? modules.get(k) : { ...modules.get(canon(k)), id: k })));
  const placed = $derived(new Set(keys.map(canon)));

  // Writes the top level only: nest members stay in their nests, nests keep their contents.
  function commit(next, pin = null) {
    viewMap(layouts, view.cls, VIEW)[BUILT] = { x: 0, y: 0, w: 1, h: 1 };
    const nests = layout.nests();
    const inNest = new Set(nests.flatMap((n) => n.keys));
    layout.move([...next.filter((it) => !inNest.has(it.id)), ...nests.map((n) => ({ id: n.id }))], cols, pin);
  }
  // `pres` is a look picked in the palette; `at` the cell area a palette drop
  // showed (a drop into a nest joins it unplaced). One undo step each.
  function add(key, nest = '', pres = null, at = null) {
    const m = modules.get(key);
    if (!m || placed.has(key) || !placeable(m.kind, !!nest)) return;
    checkpoint();
    if (nest) layout.nestAdd(nest, key);
    else commit([...items, m], at && { id: key, ...at });
    if (pres && pres !== m.control?.presentations?.[0]) (nest ? layout.nest(nest) : layout).setLook(key, { pres });
  }
  // `all` (the palette) removes every placement of the control; a card's own Remove only itself.
  function remove(key, all = true) {
    checkpoint();
    const gone = all ? keys.filter((k) => canon(k) === canon(key)) : [key];
    const next = items.filter((it) => !gone.includes(it.id));
    for (const n of layout.nests()) for (const k of gone) if (n.keys.includes(k)) layout.nestRemove(n.id, k);
    for (const k of gone) delete viewMap(layouts, view.cls, VIEW)[k];
    commit(next);
  }
  // The grid's selection: a nest goes with its members, except a member another nest also holds.
  function removeIds(ids) {
    checkpoint();
    for (const id of ids) {
      const n = layout.nests().find((x) => x.id === id);
      if (!n) { remove(id, false); continue; }
      const kept = new Set(layout.nests().filter((x) => x.id !== id).flatMap((x) => x.keys));
      layout.removeNest(id);
      n.keys.filter((k) => !kept.has(k)).forEach((k) => remove(k, false));
    }
  }
  function duplicateId(id) {
    checkpoint();
    commit(items);
    const to = instanceKey(new Set(Object.keys(viewMap(layouts, view.cls, VIEW))), baseKey(id));
    return layout.duplicate(id, to);
  }
</script>

{#snippet body(item)}
  {#if editing && builder}
    <button type="button" class="og-btn sm home-remove" aria-label={'Remove ' + item.title + ' from home'}
            onclick={() => remove(item.id, false)}>Remove</button>
  {/if}
  {#if item.control}
    {#if editing && builder && item.kind === 'field' && item.setLook}
      <LookEditor control={item.control} look={item.look} onchange={item.setLook} />
    {/if}
    <Control control={item.control} look={item.look} w={item.w} h={item.h} />
  {:else if item.telemetry}
    <TelemetryChart />
  {:else}
    <div class="home-fields">
      {#each item.fields as f (f.uid)}
        {#if f.widget === WIDGET.action}<ActionField action={f} />{:else}<Field field={f} />{/if}
      {/each}
    </div>
  {/if}
{/snippet}

<div class="home" bind:clientWidth={width}>
  {#if editing && builder}
    <Palette entries={[...modules.values()]} {placed} nests={layout.nests()} onadd={add} onremove={remove} />
  {/if}
  <DashGrid viewId={VIEW} {items} bind:editing ondelete={builder ? removeIds : null} onduplicate={builder ? duplicateId : null}
            ondropkey={builder ? (key, at, nest) => add(key, nest || '', null, at) : null} />
</div>

<style>
  .home {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    min-width: 0;
  }
  .home-remove { float: right; margin: 0 0 6px 6px; }
  /* App.svelte's .card-body: columns capped at the reading measure. */
  .home-fields {
    display: grid;
    grid-template-columns: repeat(auto-fill, min(100%, var(--measure)));
    gap: 14px var(--gap);
  }
</style>
