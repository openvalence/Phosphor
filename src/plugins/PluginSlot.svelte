<script>
  /**
   * PluginSlot.svelte — the box a tier-2 plugin hero draws into.
   *
   * Constraints:
   * - Plugins are not Svelte components (DESIGN §9 ABI insurance): the slot
   *   hands the plugin a bare element and its claimed fields, and calls the
   *   instance's update() whenever a claimed field's value, write status or
   *   staleness changes, never for a push that changes none of them. Svelte
   *   internals never reach plugin code.
   * - Every call into the plugin goes through the host's guards; a throw
   *   drops this hero and returns its fields to the generic renderer.
   */
  import { untrack } from 'svelte';
  import { machine, freshness, staleReason } from '../model/machine.svelte.js';
  import { displayValue, statusOf } from '../model/shadow.svelte.js';
  import { CH_CONTROL_OWNER } from '../../../Valence/clients/js/index.js';

  let { fields, hero } = $props();
  // A hero can go null while its block tears down (a dock withdrawn while open): nothing mounts or updates then.
  const host = $derived(hero?.host);
  // By identity: a prop read reruns an effect whenever its source object
  // changes (a card moved or resized), and a remount drops the plugin's own
  // state. Only a new hero or a new claim remounts.
  const sameHero = $derived(hero);
  const sameFields = $derived(fields);

  let el = $state(null);
  let inst = $state(null);

  $effect(() => {
    const node = el;
    const h = sameHero;
    if (!node || !h) return;
    const f = sameFields;
    const hs = h.host;
    const mounted = untrack(() => hs.mountHero(h, node, f));
    inst = mounted;
    return () => {
      untrack(() => hs.unmountHero(mounted));
      node.replaceChildren();
    };
  });

  // What update() last saw: a STATE push that changes none of it (a parked carriage republished every hub
  // tick, RFC-113) calls no update().
  let seen = [];
  // One level deep: a republished snapshot is a new object with the same fields.
  const same = (a, b) => Object.is(a, b) || (!!a && !!b && typeof a === 'object' && typeof b === 'object'
    && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => Object.is(a[k], b[k])));
  $effect(() => {
    // Subscribe to every claimed field's reported value and write status,
    // instance lists (claimRoles `instances`) included, and to the link,
    // latch and rail-owner facts api.gate and api.stale read.
    const now = [];
    const watch = (f) => {
      if (!f || !f.uid) return;
      now.push(displayValue(f, machine.samples[f.channelId]), statusOf(f), staleReason(freshness(f.channelId)));
    };
    // A claim's value is a field, or a list or map of them (instances, channels): walked to its fields.
    const walk = (f) => { if (f && f.uid) watch(f); else if (f && typeof f === 'object') for (const j of Object.values(f)) walk(j); };
    const fs = sameFields;
    for (const k in fs) walk(fs[k]);
    now.push(machine.link.phase, machine.link.roles, machine.link.stale, machine.link.sessionId,
      machine.safety, machine.samples[CH_CONTROL_OWNER], inst);
    if (now.length === seen.length && now.every((v, k) => same(v, seen[k]))) return;
    seen = now;
    const i = inst;
    untrack(() => host?.updateHero(i));
  });
</script>

<div class="plugin-slot" bind:this={el}></div>

<style>
  .plugin-slot { min-height: 40px; }
</style>
