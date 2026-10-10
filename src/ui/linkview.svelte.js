/**
 * linkview.svelte.js -- the Link page's selected channel, shared with the top bar's channel heatmap.
 *
 * Constraints: selectChannel() is the one writer besides ValencePane.svelte, which clears the selection
 * when it unmounts (a page opened from the nav starts with none) and brings the selected row into view
 * on every reveal, mounted or on arrival.
 */

export const linkView = $state({ selected: null, reveal: 0 });

/** Select a channel id and bring its row into view: the map, and a heatmap block. */
export function selectChannel(id) {
  linkView.selected = id;
  linkView.reveal++;
}
