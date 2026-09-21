---
paths:
  - "**"
---

# Governance: a pointer, not a copy

Phosphor follows the Valence Canon. It does not restate it.

- **Doctrine home:** `../Valence/.claude/rules/governance.md` (C-1..C-12: one
  fact one home, status-never-in-prose, stamp-or-hearsay, the Canon Flag duty,
  frozen list, amendment ritual, American English, comments-are-constraints).
  Read it there; a copy here would be a second home for the same fact, which
  C-1 forbids.
- **Wire numbers, protocol behavior:** the Valence repo
  (`spec/registry/registry.yaml`, `spec/SPEC.md`). Never a code-local magic
  number for anything wire-visible. A gap in the spec is fixed in the Valence
  repo FIRST, then coded against here.
- **The Valence repo is READ-ONLY from here.** Changes there are RFCs.
- **Volatile truth** (versions, what is verified, open bugs) lives on this
  repo's own dev board: `bd`, prefix `ph`. Not in prose in this directory.
- **This repo's own doctrine** is `webui.md` beside this file.

Phosphor is a CLIENT. It never carries device knowledge: no channel-id
literals, no field names lifted from one machine's catalog.
`test/check-device-knowledge.mjs` is the mechanical form of that rule and it
gates `npm run build`.
