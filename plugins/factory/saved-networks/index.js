/**
 * saved-networks -- the hub's WiFi on the Network page: the networks it hears with a tap to save one
 * (picker.js, RFC-118 draft), and the saved list under Advanced (slots.js, RFC-116 draft).
 *
 * Constraints:
 * - Built on the public plugin API alone. Every write is one provisioning intent through api.write, so
 *   the shell's pending, echo and refusal ladder applies.
 * - The shell's setup flow mounts the same picker (mountPicker) with its credential binding; the card
 *   here never sends wifi_join.
 */
import { SPEC } from './wire.js';
import { mountPicker, pickerReady } from './picker.js';

export { SPEC, mountPicker, pickerReady };

export function activate(api) {
  api.registerHero({
    id: 'saved',
    title: 'Wi-Fi',
    cells: { h: [8, 10], v: [6, 12] },
    // TODO(RFC-116, RFC-118): the claim is by channel id until the RFCs register roles.
    spec: SPEC,
    mount: (host, fields) => mountPicker(api, host, fields),
  });
}
