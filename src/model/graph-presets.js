/**
 * graph-presets.js -- starting graphs for the node editor, as plain data. A
 * preset is placed, then edited like any other nodes; nothing here runs.
 *
 * Constraints:
 * - Plain graph JSON: nodes, ops and links with preset-local ids. A node's ref
 *   is {role} (a hub field by role, the first of a list that exists) or
 *   {toy: 'linear'} (a connected toy's position-with-duration output); an op
 *   value "$max" is that output's top step. The runtime resolves them
 *   (graphRuntime.applyPreset), so a preset names no device and no field key.
 * See: docs/GRAPH.md
 */

const R = { target: ['telemetry.target', 'command.position'], wmin: ['window.min'], wmax: ['window.max'] };

export const PRESETS = [
  {
    id: 'mirror-position',
    label: 'Mirror machine position to Buttplug',
    nodes: [
      { id: 'pos', ref: { role: R.target }, x: 0, y: 0 },
      { id: 'wmin', ref: { role: R.wmin }, x: 0, y: 160 },
      { id: 'wmax', ref: { role: R.wmax }, x: 0, y: 300 },
      { id: 'dst', ref: { toy: 'linear' }, x: 760, y: 40 },
    ],
    ops: [
      { id: 'map', kind: 'map_range', clamp: true, vals: { to_min: 0, to_max: '$max' }, x: 300, y: 0 },
      { id: 'iv', kind: 'interval', x: 300, y: 340 },
    ],
    links: [
      { from: 'pos', to: 'map', port: 'v' },
      { from: 'wmin', to: 'map', port: 'from_min' },
      { from: 'wmax', to: 'map', port: 'from_max' },
      { from: 'map', to: 'dst' },
      { from: 'pos', to: 'iv', port: 'v' },
      { from: 'iv', to: 'dst', port: 'ms' },
    ],
  },
  {
    id: 'mirror-plan',
    label: 'Mirror machine plan to Buttplug',
    nodes: [{ id: 'dst', ref: { toy: 'linear' }, x: 560, y: 40 }],
    ops: [
      { id: 'end', kind: 'plan', fn: 'end', x: 0, y: 0 },
      { id: 'map', kind: 'map_range', clamp: true, vals: { from_min: 0, from_max: 1, to_min: 0, to_max: '$max' }, x: 280, y: 0 },
      { id: 'rem', kind: 'plan', fn: 'remaining', x: 0, y: 200 },
    ],
    links: [
      { from: 'end', to: 'map', port: 'v' },
      { from: 'map', to: 'dst' },
      { from: 'rem', to: 'dst', port: 'ms' },
    ],
  },
];
