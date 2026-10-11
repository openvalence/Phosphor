# The node graph: typed nodes, chains, the add menu

The node editor (`src/ui/graph/GraphEditor.svelte`) draws one graph with two
kinds of wiring. Model: `src/model/graph.js` (pure, tested by
`test/graph.test.mjs`). Runtime: `src/plugins/graph.js`
(`test/graph-runtime.test.mjs`). Browser: `test/graph-editor.test.mjs`.

## Where a chain runs

| Between source and target | Runs on | Stored in |
|---|---|---|
| exactly one map node (the seven SPEC 8.11 maps), both ends catalog fields, target an accessory field | hub | the hub's relationships STORE (SPEC 8.11) |
| one map node with a buttplug end | client | local graph store |
| any op node (below), or a chain of them | client | local graph store |

- A hub relationship is source, one map, target, evaluated on the hub, and
  it survives the client closing. That lowering is unchanged by the typed
  nodes: wiring field, map, accessory field still saves a store item.
- Everything else is client-side, under SPEC 11.6's client-edge rules:
  evaluated every `TICK_MS` (50 ms, 20 Hz); no link, no safety word, ESTOP or
  PAUSE disarms every chain, and disarming drives each target with its safe
  value once. A machine field target has no client-side safe value; the hub
  applies its own pause.
- Targets are written through the runtime's one write path (`api.write` for
  fields, `bp_toy_*` for toys). No chain value reaches the hub any other way.
- A target node's badge says where its chain runs in one word, `hub` or
  `client`; its tooltip says why.
- Map nodes do not join op chains (refused "maps join two fields"). Inside a
  chain use the op equivalents: Map Range, Threshold, Gate, Slew, Low-pass.

## Socket types

`float`, `int`, `bool`. No arrays (operator, 2026-10-02: probably unneeded).
Values ride as numbers; a bool is 0 or 1.

| Socket | Type |
|---|---|
| catalog field, unscaled integer bounded to exactly 0..1 | bool |
| catalog field, any other unscaled integer | int |
| catalog field, f32, scaled or INTENT | float |
| buttplug control | float |
| map node | float |

Implicit conversions, as Blender: int to float exact; float to int rounds;
bool to number 0 or 1; number to bool is nonzero. A link whose ends differ in
type shows a small ring at its midpoint. Socket colors: float the reality
blue, bool the intent violet, int a mix of the two.

## Nodes

One node per family; the operation is a dropdown, as Blender's Math node.
An unconnected input uses the node's own editable value.

| Node | Category | Inputs | Output | Operations |
|---|---|---|---|---|
| Value | Input | (value) | float | |
| Integer | Input | (value) | int | |
| Boolean | Input | (value) | bool | |
| Math | Math | A, B (unary ops: A) | float | Add, Subtract, Multiply, Divide, Power, Minimum, Maximum, Absolute, Round, Floor, Ceil, Modulo, Square root, Sine, Cosine |
| Clamp | Math | Value, Min, Max | float | |
| Map range | Math | Value, From min, From max, To min, To max; Clamp switch | float | |
| Compare | Logic | A, B, Epsilon (equal and not equal only) | bool | Less than, Less or equal, Equal, Not equal, Greater or equal, Greater than |
| Boolean math | Logic | A, B (Not: A) | bool | And, Or, Not, Xor, Nand, Nor |
| Switch | Logic | Switch (bool), False, True | its type | type dropdown: float, int, bool |
| Gate | Logic | Value, Open (bool) | float | |
| Threshold | Converter | Value, On above, Off below | bool | |
| Slew | Converter | Value, Rise per s, Fall per s | float | |
| Low-pass | Converter | Value, Tau (s) | float | |

Edge rules, as Blender's safe math: divide by zero and modulo by zero yield
0; square root of a negative yields 0; any other undefined result (NaN,
infinity) yields 0. Round halves up. Modulo keeps the sign of A. Map Range
with a zero-width from range yields To min. Threshold, Slew and Low-pass
share their state machines with the hub maps (`hysteresis`, `slewStep`,
`lowpassStep`). A closed Gate outputs SAFE: the target gets its safe value,
every op downstream passes SAFE on, and a Switch passes it only from the arm
it picked.

## Evaluation

- Topological order each tick (`topo`). A link that would close a cycle is
  refused when wired: "refused: would loop".
- An op whose linked input has no value (a source absent or not yet read)
  outputs nothing; everything downstream outputs nothing; the target is
  disarmed with the reason ("disarmed: Multiply has no a") and gets its
  safe value once.
- One input takes one link; wiring a second replaces the first. A target
  takes one driver: a map or a chain, never both.

## The add menu

Blender's flow (`src/ui/graph/GraphPalette.svelte`):

- Right click on the canvas, or Shift+A with the pointer over it, opens the
  menu at the pointer. `+ Add` and Shift+F10, and Shift+A or F3 with the
  pointer off the canvas, open it in the canvas; what they place drops one
  node head lower until its head row clears every node already there, the
  view following it past the bottom, so repeated adds never stack
  (`ph-qwh3`).
- Groups nest as the pages draw them (DESIGN 10.11; Valence decides
  membership and order): the hub, by name, open, holding its categories in
  tier then registry order, each holding its cards with no section, then its
  sections and their cards, in catalog order; a field no page draws sits in
  the hub's Other. Then Plugin modules (each module and the fields it
  claims), ButtplugIO (each device and its controls), and the node families:
  Input, Math, Logic, Converter, Maps. A field reads as the page labels it
  (`labelFor`). Headers sit at the row size in sentence case. Phosphor's own
  names (op nodes, maps) are in sentence case: "Map range", "Linear clamp";
  hub labels render as sent. A map node keeps its stored name.
- Opening a group scrolls its items into view; a long one keeps its header
  on screen.
- Typing in the search box ranks every item with the shell's F3 matcher
  (`src/model/fuzzy.js`) on its label, then its path, and flattens the
  results; a flat list names each source once, under its card.
- Focus stays in the search box: Up and Down walk headers and items, Right
  and Left open and close a header, Enter places an item or toggles a header,
  Escape closes.
- F3 with focus in the editor opens the same menu flat at the pointer as
  the node search; the shell's look-for keeps F3 everywhere else, and Ctrl+F
  in the editor. F3 again closes it.
- Shift+Enter, or a row's show button (the touch path), shows the item's
  node already on the canvas: centered, selected and focused, the next one
  after the selection for an op family. Enter on a field or toy already
  placed shows it too, since each appears once.
- Link-drag-search: drag a wire from a socket and release it over empty
  canvas. The menu opens there, flat, holding only what has a socket on the
  other side the dragged one can join. Placing one wires it to the dragged
  socket, to the first input of the matching type, else the first input.
  Place and wire are one undo step.
- The menu is clamped inside the editor by its measured size, and re-clamped
  whenever its content resizes.
- Send to node editor, from the shell's context menu (DESIGN 10.13): a
  mounted editor takes `phosphor-node-add` and places each field in one
  column around the view's center, one undo step; fields sent while none
  was mounted wait in `nodeQueue` and are placed when it mounts. Only add
  menu sources are placed, and a field already on the canvas is not
  doubled; the editor's status line counts each case.

## What a node says

A field or toy node says what it is and where it comes from:

- The head: its card above its name, the card's full path on hover. Once
  the graph draws from two devices (the hub and a toy) the device follows
  the card: "Oscillator · Bench". A toy's card is its device.
- The catalog's desc on one line (hub text, as sent); a toy's feature type.
- Range, unit and what each socket does: "0 to 20 Hz · in sets, out reads";
  a toy "in drives, out from apps". Each socket's tooltip says it too.
- Its live value (dimmed with its age when stale, law 8), then its write
  ladder when not settled ("pending: waiting for the hub", law 5) and its
  gate reason when it cannot be set ("gated: no hub link", law 3).
- Nodes of one card share a stripe on their top edge, in an accent picked
  by each card's first node: reality, intent, their mix, `--tx-hi`,
  `--line-4`; never a safety color.

## The view

- Node text is 11 px or more. Fit frames the graph at a zoom that keeps it
  at 9 px or more on screen (`FIT_K`, under a coarse pointer the zoom floor
  of 1). An axis the graph overflows at that zoom starts at the graph's
  top-left with 32 px padding instead of centering on its empty middle.
- The toolbar holds one row. Under 44rem of width it shows + Add, Fit and
  More; More drops the other tools below it (Escape, a pick or the canvas
  closes it).
- In a dash grid the editor is a still preview (DESIGN 10.6): no toolbar and
  no edges line until Open.
- A link whose target sits left of its source exits right and re-enters
  left: its handles grow with half the rise, so the wire clears both nodes.
- Node heads carry one stroked SVG icon set (16 px grid, 1.5 px): Input a
  set value, Math a sigma, Logic a gate, Converter a step to a ramp, a field
  a diamond, a toy a target, a map a transfer curve.
- Focus rings, node and wire selection, the marquee and a pressed tool use
  `--highlight` (docs/THEMES.md).

## Undo and keys

Every edit is one undo step: placing, wiring, cutting, deleting, moving,
duplicating, and editing a node's operation, type, clamp or values. The
keyboard paths cover op nodes: Tab reaches each node and socket, Enter on two
sockets wires them (an op input by its port), Delete, Ctrl+Z, Ctrl+Shift+Z,
Ctrl+D, the arrows.

## Persistence

Local store `phosphor.graph`, version 2: nodes, drafts, client rels, ops,
links, hub positions, the view. A version 1 graph loads unchanged with no ops
and no links.

## Text selection

Off app-wide (`src/ui/select.css`): a drag on the canvas, the grid or the
strip selects nothing. On in inputs, textareas, selects, contenteditable,
`pre`, `code`, `dd.mono` values, the log feed, and anything marked
`.selectable`.
