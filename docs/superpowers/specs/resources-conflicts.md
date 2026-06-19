# Resources Conflict-Reconciliation Layer

Status: implementing · Branch: `feat/resources-conflicts`

## Problem

A resource card's doc-side metadata (`owns.symbols`, `owns.endpoints`, `schemaSource`,
planner claims) can drift from what the source code actually contains. Today `ground`
blindly merges code grounding additively and `schema` only resolves pointers; there is
no surface that says "doc and code disagree — which is the source of truth?", and no way
to record that decision so future runs honor it.

## Goal

When a resource doc and the code disagree: **detect** it deterministically, **surface** a
human diff, let the user **resolve** by picking a source of truth, and **honor** that
choice in future `enrich`/`ground` (and leave `organise` untouched, since it does not
ground).

## Conflict kinds (deterministic, oracle-free)

For each card, doc-side = `owns.symbols` / `owns.endpoints` / `schemaSource`; code-side =
`groundCard(card, index)` plus `resolveSchemaSource` for each doc pointer.

- **dangling** — a doc `schemaSource` pointer whose `resolveSchemaSource(root, ptr).status
  !== "resolved"` (missing-file / missing-symbol / ambiguous / invalid). Points at dead or
  moved code.
- **mismatch** — a symbol appears in both doc `schemaSource` and code grounding
  `schemaSource` but at a **different path** (doc says `a.ts:Foo`, code says `b.ts:Foo`).
- **unconfirmed** — code grounding finds symbols / endpoints / schemaSource the card does
  not yet claim (additions awaiting acceptance). After `ground` accepts them they stop
  being unconfirmed.

A card has a conflict iff any kind is non-empty. Each conflict carries a stable
**fingerprint** = `sha256` over `{dangling, mismatch, unconfirmed}` (sorted, repo-relative
paths) truncated to 16 hex chars. The fingerprint changes only when the conflict content
changes, so a stale resolution (code moved on) is automatically re-surfaced as NEW.

## Surface — `gproj resources conflicts [--code-root <path>]`

Read-only. Builds the code index, computes per-card conflicts, drops any card whose current
fingerprint already has a resolution, and writes `.gproj/resources/conflicts.md` (per card:
doc-side vs code-side, the dangling/mismatch/unconfirmed lists, and a suggested `resolve`
command). Prints a summary (`N conflicts, M resolved (honored)`).

## Resolve — `gproj resources resolve <id> --prefer code|doc [--code-root <path>]`

Mutation (locks, regen OKF bundle on card change). Computes the current conflict for `<id>`,
appends a record to `.gproj/resources/resolutions.ndjson`:

```json
{"id":"<id>","prefer":"code|doc","fingerprint":"<16hex>","resolvedAt":"<iso>"}
```

NDJSON is append-only; the latest record per `(id, fingerprint)` wins. zod-validated on read;
malformed lines fail loudly.

- `--prefer code` → apply the code side to the card immediately: add unconfirmed additions,
  drop dangling pointers, rewrite mismatched pointers to the code path; then `writeAll` +
  regen OKF + journal.
- `--prefer doc` → no card mutation; record the decision (suppresses future flagging and
  tells `ground`/`enrich` to skip code-grounding for this card while the fingerprint holds).

## Honor

- **conflicts** — excludes cards with a matching-fingerprint resolution (either side); counts
  them as resolved. Only NEW / changed conflicts surface.
- **ground** — per card, if the current conflict fingerprint resolves to `prefer=doc`, skip
  the grounding merge for that card (preserve the doc). `prefer=code` / no resolution →
  current additive behavior.
- **enrich** (with `--code-root`) — same per-card suppression in the grounding step.
- **organise** — unaffected (never grounds); resolutions are left intact.

## Files

- `src/resources/resolutions.ts` — zod schema, read/append, `preferenceFor(resolutions, id, fingerprint)`.
- `src/resources/conflicts.ts` — `conflictForCard`, `detectConflicts`, `renderConflictsReport`, fingerprint.
- `src/format/paths.ts` — `resourcesConflictsPath`, `resourcesResolutionsPath`.
- `src/commands/resources.ts` — `conflicts` + `resolve` dispatch, `isResourcesMutation(resolve)=true`, honor in `ground`.
- `src/resources/enrich.ts` — honor doc-preference in the grounding merge step.
- `src/catalog.ts` — entries for `resources conflicts` and `resources resolve` (anti-rot test).
- Tests: `tests/resources/conflicts.test.ts`, `tests/resources/resolutions.test.ts`, ground/enrich honor cases.

## Verification

`tsc --noEmit` clean · `vitest run` green · demo on `application-frontend` (oracle-free:
conflicts + resolve + re-conflicts show suppression).
