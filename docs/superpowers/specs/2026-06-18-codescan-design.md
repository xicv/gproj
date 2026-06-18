# Design: organise junk-skip + verified schemaSource (real code locations)

**Date:** 2026-06-18
**Status:** Approved (design phase)
**Feature:** Two dogfood follow-ups for resources.

## Problem

Dogfooding on a real repo surfaced two defects:
1. `organise` imported `.DS_Store` files (junk) as cards.
2. `enrich` populated `schemaSource` with placeholders like `"context"` instead of
   real `path:Symbol` code pointers — so the "code locations" promise (jump from a
   doc to the code it documents via `schema <id>`) is unmet/unreliable.

## Decisions (locked)

| Item | Decision |
|---|---|
| Junk files | `organise` skips a denylist (`.DS_Store`, `Thumbs.db`, `desktop.ini`, `.Spotlight-V100`, `.Trashes`, `._*` AppleDouble) and zero-byte files |
| schemaSource trust | `enrich` keeps a `schemaSource` ref ONLY if it is well-formed `path.ext:Symbol` AND resolves to real code via the existing resolver (`src/resources/schemaSource.ts`, status `resolved`). Non-conforming / unresolvable refs (incl. `"context"`) are dropped. |

## Components

| Unit | File | Change |
|---|---|---|
| Junk skip | `src/resources/organise.ts` | a `JUNK_FILENAMES` set + zero-byte check in the scan filter; skipped files are not imported |
| Verified schemaSource | `src/resources/enrich.ts` | after merging, filter `schemaSource` entries: keep only those whose `resolveSchemaSource(root, ref)` status is `resolved`; drop the rest. Reuse the resolver exported from `src/resources/schemaSource.ts` (do not reimplement symbol scanning). |
| Planner instruction | `src/resources/enrich.ts` | tighten the prompt: schemaSource entries MUST be `relativePath.ext:Symbol` pointing at real code, or omitted — never prose/placeholder. |

If `schemaSource.ts` does not already export a single-pointer resolve helper that
returns a status, add a small exported wrapper (e.g. `resolveSchemaSource(root,
pointer): SchemaSourceStatus`) over the existing `parsePointer` + `scanSymbol`,
and have both `schema <id>` and `enrich` use it (single source of truth).

## Error handling

- Junk/zero-byte files: silently skipped during scan (counted, not errored).
- Unresolvable schemaSource: dropped silently from the card (no throw); enrich
  still succeeds. `schema <id>` and `doctor` continue to report unresolved refs
  on any that slip in via manual `add`.

## Testing (>=80%)

- organise: a tree containing `.DS_Store` + a zero-byte file + a real doc imports
  ONLY the real doc.
- enrich (mocked planner): a planner schemaSource of `["context", "src/x.ts:Real",
  "src/x.ts:Nope"]` against a fixture where `src/x.ts` defines `Real` keeps only
  `src/x.ts:Real`.
- resolver wrapper: `resolved` vs `missing-file` vs `missing-symbol` vs `invalid`.

## Scope

- **In:** junk-skip, verified-schemaSource filter + resolver wrapper, prompt tighten.
- **Out:** fuzzy symbol matching; multi-language AST (regex symbol scan stays);
  auto-suggesting schemaSource from doc body (enrich-from-planner only).
