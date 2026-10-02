/**
 * provision-wizard.test.mjs -- the `wizard` pattern's step derivation
 * (RENDERING §10, src/ui/wizard/steps.js) against a synthetic setup catalog
 * nothing ships: invented ids and names, so a pass proves the steps come from
 * catalog facts and nothing else (§11). Walks the RFC-079 `setup` category,
 * never `network`. Covers the degraded paths: no setup category, and a step
 * whose only settable field is absent.
 *
 * Run: node test/provision-wizard.test.mjs
 */
import { buildSettingsModel } from '../src/model/settings.js';
import { wizardSteps, provisionCategory, PROVISION_CATEGORY } from '../src/ui/wizard/steps.js';
import { PACKED, CHANNEL_CLASS, UI_CATEGORY, UI_RANK } from '../../Valence/clients/js/index.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  -- ' + extra : ''));
  if (!cond) fails++;
};

const lf = (name, type, extra = {}) => ({
  name, type, typeName: String(type), unit: '', scale: 1, provenanceName: 'actual',
  rank: UI_RANK.detail, unitId: null, ...extra,
});
const setup = { category: UI_CATEGORY.setup, categoryKnown: true, categoryName: 'setup' };
const state = (id, name, layout, extra = {}) => ({
  id, name, cls: CHANNEL_CLASS.STATE, dir: 0, access: 0, maxRateHz: 0, priority: 0,
  settingChannel: 0x0e90, schema: null, layout, ...setup, ...extra,
});

const CATALOG = [
  // a named group spanning a readout: one step, readout kept for feedback
  state(0x0e40, 'uplink', [
    lf('net_label', PACKED.str16, { settingKey: 1, group: 'Join' }),
    lf('net_word', PACKED.str16, { settingKey: 2, group: 'Join', flagBits: { secret: true } }),
    lf('joined', PACKED.u8, { group: 'Join' }),
  ]),
  // ungrouped, settable: its own step, titled by its entry
  state(0x0e41, 'badge_tag', [lf('badge_text', PACKED.str16, { settingKey: 3 })]),
  // ungrouped, readouts only: nothing to set, no step
  state(0x0e42, 'link_stat', [lf('signal', PACKED.u8, {})]),
  // a settable diagnostic group never joins the ceremony
  state(0x0e44, 'radio_dbg', [lf('dbg_level', PACKED.u8, { settingKey: 4, group: 'Debug', rank: UI_RANK.diagnostic })]),
  // a group whose only setting is rank=hidden (absent): readout left, no step
  state(0x0e45, 'spare', [
    lf('spare_knob', PACKED.u8, { settingKey: 5, group: 'Spare', rank: UI_RANK.hidden }),
    lf('spare_seen', PACKED.u8, { group: 'Spare' }),
  ]),
  // an action verb in the category: its own step
  { id: 0x0e43, name: 'beacon_cmd', cls: CHANNEL_CLASS.INTENT, dir: 1, access: 2, maxRateHz: 2,
    priority: 1, settingChannel: null, layout: null, ...setup,
    schema: [{ key: 1, name: 'beacon_op', type: 1, typeName: 'uint', role: 'action.identify', options: ['none', 'blink'] }] },
  // settable network entry: provisioning's pre-RFC-079 home, no longer walked
  state(0x0e50, 'decoy', [lf('decoy_knob', PACKED.u8, { settingKey: 6 })],
    { category: UI_CATEGORY.network, categoryName: 'network' }),
];

console.log('provisioning wizard steps vs. a synthetic setup catalog\n');

ok('the wizard walks the registry setup category (RFC-079)',
   PROVISION_CATEGORY === UI_CATEGORY.setup && UI_CATEGORY.setup != null);

const model = buildSettingsModel(CATALOG);
const cat = provisionCategory(model);
ok('the wizard walks setup, not the settable network entry', cat && cat.id === UI_CATEGORY.setup);

const steps = wizardSteps(cat);
const ids = steps.map((s) => s.id).join(',');
ok('steps: named group, then one per ungrouped settable entry, in catalog order',
   ids === 'g:Join,ch:' + 0x0e41 + ',ch:' + 0x0e43, ids);
ok('a step keeps its readouts beside its settings',
   steps[0] && steps[0].fields.map((f) => f.name).join(',') === 'net_label,net_word,joined');
ok('a secret setting reaches its step as a secret (never shown)',
   steps[0] && steps[0].fields[1].widget === 'secret');
ok('an ungrouped step is titled by its entry', steps[1] && steps[1].title === 'Badge tag', steps[1]?.title);
ok('an action reaches its step as a trigger', steps[2] && steps[2].fields[0].widget === 'action');
ok('readouts-only entry, diagnostic group, and absent-setting group are not steps',
   !steps.some((s) => ['ch:' + 0x0e42, 'g:Debug', 'g:Spare'].includes(s.id)));

// ---- degraded: no setup category; a settable network one is not a stand-in --
const bare = buildSettingsModel(CATALOG.filter((e) => e.category !== UI_CATEGORY.setup));
ok('no setup category: no wizard (network is no fallback), and no steps from null', provisionCategory(bare) === null && wizardSteps(null).length === 0);
ok('no model yet: no wizard', provisionCategory(null) === null);

// ---- degraded: the category exists but every setting in it is absent ------
const hollow = buildSettingsModel([CATALOG[2], CATALOG[4]]);
ok('a category with nothing settable declines (law 7) instead of an empty wizard',
   !!hollow.categories.find((c) => c.id === UI_CATEGORY.setup) && provisionCategory(hollow) === null);

console.log(fails ? '\nFAIL -- ' + fails + ' check(s)' : '\nPASS -- provision wizard steps');
process.exit(fails ? 1 : 0);
