/**
 * confirm.svelte.js — the one confirm request the overlay layer draws.
 *
 * Constraints: one request at a time; a newer ask cancels the older one
 * (resolves false), because two stacked hazard prompts would let a stale
 * "yes" land on the wrong verb. ConfirmLayer.svelte is the only renderer.
 */

export const confirmUi = $state({ req: null });

/**
 * Ask the operator. Resolves true only on an explicit confirm.
 * @param {{title: string, body?: string, confirmLabel?: string}} copy
 * @returns {Promise<boolean>}
 */
export function askConfirm(copy) {
  return new Promise((resolve) => {
    if (confirmUi.req) confirmUi.req.resolve(false);
    confirmUi.req = { ...copy, resolve };
  });
}

/** Close the current request with the operator's answer. */
export function answerConfirm(ok) {
  const r = confirmUi.req;
  confirmUi.req = null;
  if (r) r.resolve(!!ok);
}
