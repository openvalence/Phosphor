/**
 * steps.js: the `wizard` pattern's steps (RENDERING §10), derived from the
 * catalog alone. Pure, so test/provision-wizard.test.mjs runs it with no hub.
 *
 * Constraints:
 * - A step is a subgroup, the unit §11 already makes its own screen on
 *   `glance`; ungrouped fields form one step per catalog entry. Category,
 *   group and declaration order come from buildSettingsModel untouched.
 * - A step with nothing to set is not a step (its readouts stay on the
 *   category page); diagnostic groups never join a ceremony (§9).
 * - Never a channel or field found by name (RENDERING §13 law 6).
 */
import { UI_CATEGORY } from '../../../../Valence/clients/js/index.js';
import { humanize } from '../../model/settings.js';

// RFC-079: `setup` is the commissioning surface; `network` is never walked.
export const PROVISION_CATEGORY = UI_CATEGORY.setup;

const settable = (fields) => fields.some((f) => !f.readOnly);

/** Steps of one category, in catalog order. Absent category: no steps. */
export function wizardSteps(category) {
  if (!category) return [];
  const steps = [];
  for (const g of category.groups) {
    if (g.diagnostic) continue;
    if (g.name) {
      steps.push({ id: 'g:' + g.name, title: g.name, fields: g.fields });
      continue;
    }
    const byEntry = new Map();
    for (const f of g.fields) {
      if (!byEntry.has(f.channelId)) byEntry.set(f.channelId, []);
      byEntry.get(f.channelId).push(f);
    }
    for (const [ch, fields] of byEntry) {
      steps.push({ id: 'ch:' + ch, title: humanize(fields.find((f) => f.channelName)?.channelName) || 'Settings', fields });
    }
  }
  return steps.filter((s) => settable(s.fields));
}

/** The category the provisioning wizard walks, or null when it has no steps. */
export function provisionCategory(model) {
  const cat = model ? model.categories.find((c) => c.known && c.id === PROVISION_CATEGORY) : null;
  return cat && wizardSteps(cat).length ? cat : null;
}
