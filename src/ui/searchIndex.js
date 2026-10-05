/**
 * searchIndex.js -- non-catalog entries for F3 (LookFor.svelte).
 *
 * Constraints:
 * - A source is a function returning [{ label, path, go }]. LookFor calls it
 *   inside a $derived, so whatever reactive state the function reads
 *   rebuilds the index; a source must not cache.
 * - `go` runs after F3 closes; it switches page itself (App's selectTab is
 *   not visible here), and an entry without `go` lists inert.
 */
import { SvelteMap } from 'svelte/reactivity';

const sources = new SvelteMap();

/** Register (or replace) source `id`; returns the unregister function. */
export function registerSearch(id, source) {
  sources.set(id, source);
  return () => { if (sources.get(id) === source) sources.delete(id); };
}

/** Every registered entry, in registration order. */
export const searchEntries = () => [...sources.values()].flatMap((fn) => fn() || []);
