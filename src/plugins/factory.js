/**
 * factory.js -- the plugins shipped with Phosphor (docs/PLUGINS.md, Factory
 * plugins): bundled, enabled by default in the shell, disabled like any other.
 * Same contract as an installed plugin; nothing here is a kernel import.
 */
import * as advancedPenetration from '../../plugins/factory/advanced-penetration/index.js';
import advancedPenetrationManifest from '../../plugins/factory/advanced-penetration/manifest.json' with { type: 'json' };
import * as funscriptPlayer from '../../plugins/factory/funscript-player/index.js';
import funscriptPlayerManifest from '../../plugins/factory/funscript-player/manifest.json' with { type: 'json' };

export const FACTORY = [
  { manifest: advancedPenetrationManifest, module: advancedPenetration },
  { manifest: funscriptPlayerManifest, module: funscriptPlayer },
];
