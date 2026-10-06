/**
 * resetGate.js -- does a page reset need the modal? (RENDERING §8.3)
 *
 * Constraints:
 * - A held reset is its own confirmation for ordinary settings; any field
 *   whose write to its default is confirm-gated (a flip, a destructive flag,
 *   a background-run enable) sends the whole reset through the modal.
 */
import { settingNeedsConfirm } from '../model/actions.js';

export const resetNeedsModal = (fields, samples) =>
  fields.some((f) => settingNeedsConfirm(f, samples[f.channelId]?.[f.name], f.dflt));
