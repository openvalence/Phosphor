/**
 * stampmenu.js -- the footer stamp's own context menu (ph-75yn): Copy versions
 * and Copy diagnostics (JSON). A right-click, or the long press that is the
 * touch right-click, on the stamp opens it; the shell menu stays out (the
 * event is prevented first, contextmenu.js).
 *
 * Constraints:
 * - What leaves is whatever model/stamp.js builds from the snapshot below;
 *   add nothing to the snapshot that stamp.js does not allowlist.
 * - The copy rides contextmenu.js `copy` (native clipboard in the shell) and
 *   the status slot says so: no layout of its own.
 */
import { menu } from '../plugins/kit.js';
import { machine, linkKind } from '../model/machine.svelte.js';
import { health, context } from '../model/health/health.svelte.js';
import { versionLines, diagnostics, STAMP_SAYS } from '../model/stamp.js';
import { PROTO_VER, WS_SUBPROTOCOL } from '../../../Valence/clients/js/generated/registry_vocab.js';
import PIN from '../model/neutrino/neutrino.pin?raw';
import { copy } from './contextmenu.js';

const MODE = import.meta.env.MODE;
const shellVersion = () => (import.meta.env.TAURI_ENV_PLATFORM
  ? import('@tauri-apps/api/app').then((m) => m.getVersion()).catch(() => null)
  : Promise.resolve(null));

/** A plain snapshot for model/stamp.js. */
async function snapshot() {
  const cx = context(), l = machine.link, id = l.hubIdentity;
  return {
    shell: await shellVersion(), build: typeof __UI_BUILD__ !== 'undefined' ? __UI_BUILD__ : null,
    mode: MODE === 'web' || MODE === 'mini' ? MODE : 'app', platform: cx.app.platform, engine: cx.app.engine,
    neutrino: l.virtual ? (/^nucleus (\w+)/m.exec(PIN) || [])[1] : null,
    phase: l.phase, transport: l.phase === 'idle' ? null : linkKind(),
    product: id && id.product, firmware: id && id.fw_version, proto: PROTO_VER, subprotocol: WS_SUBPROTOCOL,
    etag: machine.catalog.etag, bootId: l.bootId, tier: l.roles, deadmanMs: l.deadmanMs,
    stats: machine.stats, health: { link: health.link, device: health.device, machine: health.machine, incidents: health.incidents },
  };
}

/** `oncontextmenu` of the stamp cell. */
export function openStampMenu(e) {
  e.preventDefault();
  menu({ x: e.clientX, y: e.clientY, items: [
    { label: 'Copy versions', run: async () => copy(versionLines(await snapshot()), STAMP_SAYS[0]) },
    { label: 'Copy diagnostics (JSON)', run: async () => copy(JSON.stringify(diagnostics(await snapshot()), null, 2), STAMP_SAYS[1]) },
  ] });
}
