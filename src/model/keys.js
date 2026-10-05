/**
 * keys.js -- every key and pointer binding in the client, as data. The F1
 * overlay (ui/KeyHelp.svelte) renders it; test/keys.test.mjs proves each
 * binding exists in the file `src` names.
 *
 * Constraints:
 * - Documents, never dispatches: a binding lives in its component. F1 and F3
 *   are the only keys bound off this table (KeyHelp, LookFor).
 * - A binding added or changed in a component changes here in the same commit.
 * - Wording follows docs/COPY.md: one terse fragment per field.
 */
export const KEYS = [
  { group: 'Global', items: [
    { keys: 'F1', does: 'Key help', where: 'Anywhere', src: 'src/ui/KeyHelp.svelte' },
    { keys: 'F3, Ctrl+F', does: 'Look for a control', where: 'Anywhere', src: 'src/ui/LookFor.svelte' },
    { keys: 'Escape', does: 'Close dialog, menu or popover', where: 'Anywhere', src: 'src/ui/ConfirmLayer.svelte' },
    { keys: 'F11', does: 'Fullscreen', where: 'Plugin page', src: 'src/App.svelte' },
    { keys: 'Escape', does: 'Leave fullscreen', where: 'Fullscreen page', src: 'src/App.svelte' },
    { keys: 'Arrows', does: 'Switch page', where: 'Page tabs', src: 'src/App.svelte' },
    { keys: 'Ctrl+=, Ctrl+-', does: 'UI scale up, down', where: 'Anywhere', src: 'src/ui/ScaleControl.svelte' },
    { keys: 'Ctrl+0', does: 'UI scale to 100%', where: 'Anywhere', src: 'src/ui/ScaleControl.svelte' },
    { keys: 'Ctrl+wheel', does: 'UI scale', where: 'Off canvases and sliders', src: 'src/ui/ScaleControl.svelte' },
  ] },
  { group: 'Safety', items: [
    { keys: 'Enter, Space', does: 'Fire stop, pause or override', where: 'Focused safety op', src: 'src/ui/widgets/SafetyOp.svelte' },
    { keys: 'Hold Enter, Space', does: 'Release a latched e-stop', where: 'Focused e-stop', src: 'src/ui/widgets/SafetyOp.svelte' },
    { keys: 'Hold Enter, Space', does: 'Close Phosphor', where: 'Close popover', src: 'src/shell/ShellStrip.svelte' },
  ] },
  { group: 'Controls', items: [
    { keys: 'Arrows', does: 'Step value', where: 'Slider, knob', src: 'src/ui/Field.svelte' },
    { keys: 'Page Up, Page Down', does: 'Step a tenth of the range', where: 'Slider, knob', src: 'src/ui/Field.svelte' },
    { keys: 'Home, End', does: 'Minimum, maximum', where: 'Slider, knob, options', src: 'src/ui/Field.svelte' },
    { keys: 'Alt+drag', does: 'Send on release', where: 'Slider, knob, range', src: 'src/ui/Field.svelte' },
    { keys: 'Shift+drag', does: 'Fine turn, a tenth of the gain', where: 'Slider, knob, range', src: 'src/ui/Field.svelte' },
    { keys: 'Ctrl+drag', does: 'Snap to the range decade', where: 'Slider, knob, range', src: 'src/ui/Field.svelte' },
    { keys: 'Shift+Arrows', does: 'Fine step', where: 'Slider, knob', src: 'src/ui/Field.svelte' },
    { keys: 'Ctrl+Arrows', does: 'Step to the next decade multiple', where: 'Slider, knob', src: 'src/ui/Field.svelte' },
    { keys: 'Wheel', does: 'Turn; Shift for one step', where: 'Focused knob', src: 'src/ui/Field.svelte' },
    { keys: 'Arrows', does: 'Move between options', where: 'Option buttons', src: 'src/ui/Field.svelte' },
    { keys: 'Hold', does: 'Repeat step', where: 'Stepper buttons', src: 'src/ui/Field.svelte' },
  ] },
  { group: 'Rail', items: [
    { keys: 'Arrows', does: 'Jog one step', where: 'Jog tape', src: 'src/ui/hero/RailWidget.svelte' },
    { keys: 'Page Up, Page Down', does: 'Jog ten steps', where: 'Jog tape', src: 'src/ui/hero/RailWidget.svelte' },
    { keys: 'Home, End', does: 'Jog to window end', where: 'Jog tape', src: 'src/ui/hero/RailWidget.svelte' },
    { keys: 'Arrows', does: 'Move window', where: 'Stroke window', src: 'src/ui/hero/RailWidget.svelte' },
    { keys: 'Arrows, Page Up, Page Down', does: 'Move edge', where: 'Window edge', src: 'src/ui/hero/RailWidget.svelte' },
    { keys: 'Home, End', does: 'To rail end', where: 'Window, window edge', src: 'src/ui/hero/RailWidget.svelte' },
    { keys: 'Alt+drag', does: 'Send on release', where: 'Tape, window, edges', src: 'src/ui/hero/RailWidget.svelte' },
  ] },
  { group: 'Grid', items: [
    { keys: 'Ctrl+Z', does: 'Undo last layout change', where: 'Edit layout', src: 'src/ui/dash/DashGrid.svelte' },
    { keys: 'Escape', does: 'Cancel drag, clear selection', where: 'Edit layout', src: 'src/ui/dash/DashGrid.svelte' },
    { keys: 'Shift+drag, Ctrl+drag', does: 'Add box-select', where: 'Edit layout grid', src: 'src/ui/dash/DashGrid.svelte' },
    { keys: 'Arrows', does: 'Move card', where: 'Card handle', src: 'src/ui/dash/DashItem.svelte' },
    { keys: 'Shift+Arrows', does: 'Resize card', where: 'Card handle', src: 'src/ui/dash/DashItem.svelte' },
    { keys: 'Enter', does: 'Pick look', where: 'Card handle', src: 'src/ui/dash/DashItem.svelte' },
    { keys: 'Delete, Backspace', does: 'Remove card', where: 'Card handle', src: 'src/ui/dash/DashItem.svelte' },
    { keys: 'Shift+click, Ctrl+click', does: 'Add to selection', where: 'Card handle', src: 'src/ui/dash/DashItem.svelte' },
    { keys: 'Arrows', does: 'Resize card', where: 'Resize handle', src: 'src/ui/dash/DashItem.svelte' },
  ] },
  { group: 'Node editor', items: [
    { keys: 'Tab', does: 'Next node or socket', where: 'Node editor', src: 'src/ui/graph/GraphEditor.svelte' },
    { keys: 'Enter', does: 'Start or finish a wire', where: 'Socket', src: 'src/ui/graph/GraphEditor.svelte' },
    { keys: 'Arrows', does: 'Move selection; Shift for five', where: 'Node', src: 'src/ui/graph/GraphEditor.svelte' },
    { keys: 'Delete, Backspace', does: 'Delete selection', where: 'Node editor', src: 'src/ui/graph/GraphEditor.svelte' },
    { keys: 'Ctrl+Z', does: 'Undo', where: 'Node editor', src: 'src/ui/graph/GraphEditor.svelte' },
    { keys: 'Ctrl+Shift+Z, Ctrl+Y', does: 'Redo', where: 'Node editor', src: 'src/ui/graph/GraphEditor.svelte' },
    { keys: 'Ctrl+D', does: 'Duplicate selection', where: 'Node editor', src: 'src/ui/graph/GraphEditor.svelte' },
    { keys: 'Ctrl+A', does: 'Select all', where: 'Node editor', src: 'src/ui/graph/GraphEditor.svelte' },
    { keys: 'Shift+A, Right click', does: 'Add menu at the pointer', where: 'Canvas', src: 'src/ui/graph/GraphEditor.svelte' },
    { keys: 'Menu, Shift+F10', does: 'Add menu', where: 'Node editor', src: 'src/ui/graph/GraphEditor.svelte' },
    { keys: 'Drop a wire on canvas', does: 'Add a fitting node, wired', where: 'Wire drag', src: 'src/ui/graph/GraphEditor.svelte' },
    { keys: 'Type', does: 'Search every category', where: 'Add menu', src: 'src/ui/graph/GraphPalette.svelte' },
    { keys: 'Up, Down', does: 'Walk headers and items', where: 'Add menu', src: 'src/ui/graph/GraphPalette.svelte' },
    { keys: 'Right, Left', does: 'Open, close a header', where: 'Add menu', src: 'src/ui/graph/GraphPalette.svelte' },
    { keys: 'Enter', does: 'Place item, toggle header', where: 'Add menu', src: 'src/ui/graph/GraphPalette.svelte' },
    { keys: 'Escape', does: 'Close', where: 'Add menu', src: 'src/ui/graph/GraphPalette.svelte' },
    { keys: 'Escape', does: 'Cancel wire or menu', where: 'Node editor', src: 'src/ui/graph/GraphEditor.svelte' },
    { keys: 'Wheel', does: 'Zoom', where: 'Node editor', src: 'src/ui/graph/GraphEditor.svelte' },
  ] },
];
