<script>
  /**
   * PluginSlot.svelte — the box a tier-2 plugin hero draws into.
   *
   * Constraints:
   * - Plugins are not Svelte components (DESIGN §9 ABI insurance): the slot
   *   hands the plugin a bare element and its claimed fields, and calls the
   *   instance's update() whenever a claimed field's value or write status
   *   changes. Svelte internals never reach plugin code.
   * - Every call into the plugin goes through the host's guards; a throw
   *   drops this hero and returns its fields to the generic renderer.
   */
  import { untrack } from 'svelte';
  import { machine } from '../model/machine.svelte.js';
  import { displayValue, statusOf } from '../model/shadow.svelte.js';

  let { fields, hero } = $props();
  const host = $derived(hero.host);

  let el = $state(null);
  let inst = $state(null);

  $effect(() => {
    const node = el;
    if (!node) return;
    const h = hero;
    const f = fields;
    const mounted = untrack(() => host.mountHero(h, node, f));
    inst = mounted;
    return () => {
      untrack(() => host.unmountHero(mounted));
      node.replaceChildren();
    };
  });

  $effect(() => {
    // Subscribe to every claimed field's reported value and write status,
    // instance lists (claimRoles `instances`) included, and to the link
    // facts api.gate and api.stale read.
    const watch = (f) => {
      if (!f || !f.uid) return;
      displayValue(f, machine.samples[f.channelId]);
      statusOf(f);
      void machine.sampleTs[f.channelId];
    };
    for (const k in fields) {
      const f = fields[k];
      if (Array.isArray(f)) for (const m of f) for (const j in m) watch(m[j]);
      else watch(f);
    }
    void machine.link.phase; void machine.link.roles; void machine.link.stale;
    const i = inst;
    untrack(() => host.updateHero(i));
  });
</script>

<div class="plugin-slot" bind:this={el}></div>

<style>
  .plugin-slot { min-height: 40px; }
</style>
