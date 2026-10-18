/**
 * factory-mini.js -- the mini build's factory plugins (vite.config.js swaps it in for factory.js): Advanced
 * Penetration alone. Same shape as factory.js.
 */
import * as advancedPenetration from '../../plugins/factory/advanced-penetration/index.js';
import advancedPenetrationManifest from '../../plugins/factory/advanced-penetration/manifest.json' with { type: 'json' };

export const FACTORY = [{ manifest: advancedPenetrationManifest, module: advancedPenetration }];
