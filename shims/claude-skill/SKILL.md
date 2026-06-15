---
name: gproj
description: Use when the user wants to run a persistent planner-brain loop (goal → plan → execute → review → decide) across rounds without losing context. Shells the `gproj` CLI; state lives in .gproj/.
---

# gproj — persistent planner brain

Drive the loop by shelling the CLI. NEVER reimplement its logic inline.

- New project: `gproj init "<goal>"`
- One round (auto, stops at human gate): `gproj advance`
- Inspect: `gproj status`
- Human decision after review: `gproj decide accept|adjust|reject`
- Backends via env: `GPROJ_PLANNER=oracle-browser|openai-responses`, `GPROJ_EXECUTOR=codex|claude-code`.

The planner reviews from evidence (diff + tests) only — never give it raw repo access. The `.gproj/` store is git-versioned; commit it with the code.
