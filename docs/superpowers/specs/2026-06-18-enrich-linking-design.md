# Design: candidate-grounded enrich linking

**Date:** 2026-06-18

## Problem
`audit` on a real 253-card graph: healthScore 53/100, only 36% of cards linked,
144 orphans, 163 components; sampled links judged "weak". enrich links sparsely
because the planner only gets a flat id->title index of ALL cards (capped) with no
signal about which are actually related.

## Fix
Per card in a batch, precompute the top-K RELATED candidate cards (deterministic
overlap scoring: shared tags, same category, shared owns symbols/endpoints/
configKeys, shared schemaSource). Feed each card its focused candidate list
(id, title, why) to the planner, which confirms genuine links + assigns rel type.
This grounds linking -> denser + stronger links. The flat linkTargets index is
kept for cross-topic links. Measure improvement with `resources audit` (health
score / linked% / orphans before vs after).

## Components
- src/resources/candidates.ts: `relatedCandidates(card, allCards, k)` pure scorer.
- src/resources/enrich.ts: include per-card `candidates` in the planner pack;
  instruction prefers candidates; output unchanged (links[{rel,toId}]).
- tests for scorer + pack inclusion.

## Out of scope
auto-linking without planner confirmation; embedding similarity (overlap-only).
