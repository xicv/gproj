# Design: resources audit / judge / eval — measure & prove enrichment quality

**Date:** 2026-06-18
**Status:** Approved (design phase)
**Feature:** quantify whether the resource knowledge graph is well-formed, the links are correct, and it matches expectations.

## Problem

enrich produces categories/tags/links (123 links over 253 cards on a real repo),
but there is no way to MEASURE whether the organization is good or whether the
links capture the relationships people expect. "It produced links" != "it
organized well." We need to measure + prove quality.

## Research basis (2026)

- KG quality dimensions: accuracy/correctness, completeness, consistency,
  redundancy; correctness via precision/recall/F1; structural metrics
  (connectivity/components) measurable without ground truth.
- LLM-as-judge for links: GraphJudge ("Yes that is true / No") reaches F1 ~87%,
  ~90% human agreement; judge must be deterministic + spot-checked.
- Retrieval eval: precision@k / recall / nDCG against an expected-set; eval-set
  can be LLM-generated then human-curated; hybrid human+LLM best.

## Tiers (all three in scope)

### Tier 1 — structural audit (deterministic, no LLM)
`gproj resources audit [--json]`:
- coverage: total, % enriched (`enrichedAt`), % with >=1 link, % tags, % intent,
  % owns, % schemaSource.
- connectivity (links as an undirected graph): orphans (0 links), connected
  components, largest-component %, avg degree, max degree (hubs), density.
- integrity: dangling links (toId not a card), duplicate-target links, self-links.
- distribution: category histogram, top tags, top hub cards.
- health score 0-100 (penalize orphans, fragmentation, dangling) + human-readable
  flags. `--json` for tooling.

### Tier 2 — LLM-as-judge sampling (planner)
`gproj resources audit --judge [--sample N]` (default N=20):
- sample N links; for each, prompt the planner with both cards' title+excerpt +
  the `rel`; planner returns `{ verdict: "correct"|"weak"|"incorrect", reason }`
  (Zod-validated, untrusted). Aggregate -> link-precision %.
- optionally sample category assignments the same way.
- deterministic prompt; print precision + the sampled verdicts. Uses the resilient
  oracle backend (auto-fallback / PlannerUnavailableError -> halt gracefully).

### Tier 3 — retrieval / expectation eval
`gproj resources eval <evalset.json> [--json]`:
- evalset: `{ queries: [{ query, expectedIds: [] }], links?: [{ fromId, rel, toId }] }`.
- for each query: run ranked `find`, compute precision@k, recall, nDCG vs
  expectedIds; aggregate (mean). For expected links: report how many are present
  (link recall).
- `gproj resources eval --generate [--out f]`: planner proposes a candidate
  evalset from the corpus (queries + expected ids) for the human to curate.
- print metrics report; `--json` for tooling.

## Components

| Unit | File | Responsibility |
|---|---|---|
| Structural metrics | `src/resources/audit.ts` | pure functions over `ResourceCard[]`: coverage, graph components/degree/density, integrity, distribution, health score |
| Judge | `src/resources/judge.ts` | sample links/categories; planner prompt; Zod-validate verdicts; aggregate precision |
| Eval | `src/resources/eval.ts` | parse evalset (Zod); precision@k / recall / nDCG over `find`; `--generate` via planner |
| CLI | `src/commands/resources.ts` | `audit [--json] [--judge] [--sample N]`, `eval <set> [--json] [--generate] [--out f]` |
| Catalog | `src/catalog.ts` | add `resources audit` + `resources eval` entries (anti-rot) |
| Schema | `src/format/schema.ts` | `EvalSetSchema` (queries + optional links) |

## Error handling
- audit (T1) never calls the planner; pure + instant.
- `--judge` / `eval --generate`: planner failure -> graceful (PlannerUnavailableError
  halts with a resumable message, partial verdicts kept).
- eval: malformed evalset -> clear Zod error; unknown expectedIds flagged, not fatal.

## Testing (>=80%)
- audit: fixture graph -> correct orphans/components/density/dangling/self/dup,
  health score monotonic (more orphans -> lower).
- judge: mocked planner verdicts -> precision aggregation; Zod-rejects malformed.
- eval: fixture cards + evalset -> known precision@k / recall / nDCG; malformed set rejected.
- catalog anti-rot: audit + eval present.

## Scope / phasing
- The planner may slice: T1 audit first, then T2 judge, then T3 eval.
- Out: graph visualization; link-prediction-based scoring; auto-fixing bad links
  (audit reports; enrich/​link fix).
