# Copy

Tooltips, hints, placeholders, empty states and status lines read like a
Blender tooltip (operator ruling 2026-10-02).

1. One fragment: an imperative or a noun phrase, under about eight words.
2. No second sentence, no rationale, no "so that", no hedging.
3. Sentence case, no trailing period; a ladder reason may start lowercase.
4. A tooltip that repeats its label is deleted; so is a hint the visual shows. `src/ui/tip.js` enforces it at runtime: a tip equal to the element's visible text, or to its aria-label while it has visible text, is never shown (case, spacing and a trailing shortcut hint do not count); an icon-only element and clipped text keep theirs.
5. A subline under a button exists only to carry live state: a value, a count, a state word.
6. A ladder reason (RENDERING law 5) stays text, terse: "no answer from the hub", "refused: NOT_HOMED".
7. The story goes in the docs, never in the UI.
8. Hub text (a catalog desc) is the hub's copy and renders as sent.
9. Plugin manifest descriptions follow the same rule (docs/PLUGINS.md).
10. A tooltip is `data-tip` (a kit control's `tip`); the native `title` attribute is never written, and `src/ui/tip.js` converts one that arrives anyway. `test/copy-lint.mjs` in `npm run check` fails a literal title, data-tip or placeholder over 60 characters, with ". ", or with "so that", "allows you", "simply", "just", "in order to".
11. A health line (status slot, Log, Health list) is a measured fact with the number that raised it, never a verdict about Phosphor; its tooltip is its detail, one fragment a line: what was measured, since when, the threshold, the one action, the click. It never repeats the line (operator 2026-10-09; `test/health.test.mjs` holds every condition to it).

| Before | After |
|---|---|
| Drag on the canvas selects a box instead of panning (Shift+drag does it once) | Drag to box-select (Shift+drag) |
| Offered once a Bluetooth session learns the hub's WiFi endpoint | No WiFi endpoint known |
| this session is not authorized to change settings | session not authorized |
| No log lines yet. The hub's log and plugin messages arrive here while a session is live. | No log lines yet |
| refused: this edge would close a feedback loop (the hub refuses it too, SPEC 8.11) | refused: feedback loop (SPEC 8.11) |
| Phosphor slows down over time (its tooltip the same words) | Memory up 140 MB in 35 min (tooltip: lowest reading per 5 min 28 to 168 MB, since, the threshold, Restart Phosphor to free it) |
