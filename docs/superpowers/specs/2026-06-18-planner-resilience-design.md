# Design: planner resilience — survive ChatGPT Pro limits / model-selector drift

**Date:** 2026-06-18
**Status:** Approved (design phase)
**Feature:** make the oracle-browser planner robust to "Pro unavailable" and surface limits clearly + resumably.

## Problem

A long enrich run on a real repo failed ~half its batches with an EMPTY error.
Root cause (found by a raw oracle probe): ChatGPT Pro hit its usage limit, so the
web UI's model-selector button disappeared; oracle's default model strategy tries
to click it and fails with `Unable to locate the ChatGPT model selector button`
and `Model selection evidence: requested=Pro; resolved=(unavailable)`. That
message is on oracle's STDOUT, but gproj's backend only reports
`stderr.slice(-500)` (empty) — so every batch died blind, and enrich kept firing
all remaining (doomed) batches.

Proven workaround: `oracle --browser-model-strategy current` succeeds (uses the
already-selected model) even when Pro is `(unavailable)`.

## Decisions (locked)

| Topic | Decision |
|---|---|
| Model strategy | Try configured strategy (default `select`); on a model-selector/unavailable failure, retry once with `current`. Env `GPROJ_ORACLE_MODEL_STRATEGY` overrides. |
| Error visibility | Capture STDOUT too; include the tail of stdout+stderr in the thrown error so the real reason surfaces. |
| Classification | Detect a `planner-unavailable` class (rate limit / Pro unavailable / selector-gone) via markers, and throw a typed `PlannerUnavailableError`. |
| Circuit-break | enrich aborts remaining batches on the first `PlannerUnavailableError` instead of firing them all. |
| Messaging | Distinct, resumable message + summary status; never lose committed progress. |

## Components

| Unit | File | Change |
|---|---|---|
| Typed error | `src/backends/planner.ts` (or a small `src/backends/errors.ts`) | export `class PlannerUnavailableError extends Error` |
| oracle backend | `src/backends/oracleBrowser.ts` | pass `--browser-model-strategy <strategy>` (default `select`, env `GPROJ_ORACLE_MODEL_STRATEGY`); capture stdout; on close!=0 build error from `stdout`+`stderr` tails; if markers indicate model-selector/unavailable AND strategy was not already `current`, retry ONCE with `current`; if still failing and markers indicate limit/unavailable, throw `PlannerUnavailableError(message)` (else generic Error). Keep the existing one-retry-on-transient behavior. |
| Marker set | `src/backends/oracleBrowser.ts` | constants: `Unable to locate the ChatGPT model selector`, `resolved=(unavailable)`, `usage limit`, `rate limit`, `try again later`, `you have reached` (case-insensitive) |
| enrich circuit-break | `src/resources/enrich.ts` | if a batch rejects with `PlannerUnavailableError`, stop scheduling further batches; mark run `halted`; emit `event:"halted", reason` and set summary status; already-committed batches persist |
| summary status | `src/resources/enrich.ts` | `EnrichSummary` gains `halted?: boolean` / `status`; CLI prints a resumable message naming pending count + how to resume + the `openai-responses` fallback |

## Behavior

```
oracle call:
  run with strategy = env GPROJ_ORACLE_MODEL_STRATEGY ?? "select"
  on failure:
    err = oracle-browser failed (...): <stdout tail> <stderr tail>
    if markers(selector/unavailable) and strategy != "current": retry once with "current"
    if still failing:
      if markers(limit/unavailable): throw PlannerUnavailableError(human message)
      else: throw Error(err)   // generic transient, existing retry already applied

enrich:
  per batch: on PlannerUnavailableError -> stop remaining batches, summary.halted = true
  print: "Planner unavailable (ChatGPT Pro limit / model unavailable). Enriched
          X/Y; Z pending — nothing lost, resumable. Re-run `gproj resources enrich`
          later, or use GPROJ_PLANNER=openai-responses."
```

## Error handling / messaging

- Committed batches are never rolled back (writeAll per successful batch already
  atomic). enrich exits 0 with a `halted` summary (a planner limit is not a gproj
  failure). `package`/`review` surface the same clearer `PlannerUnavailableError`
  message instead of an empty one.

## Testing (>=80%, injected spawn)

- oracleBrowser: injected spawn returns the model-selector error on first call,
  success on a `current` retry -> resolves (auto-fallback works); strategy flag is
  passed; stdout is included in error text.
- oracleBrowser: spawn returns limit markers on both attempts -> throws
  `PlannerUnavailableError`.
- enrich: a mocked planner that throws `PlannerUnavailableError` on batch 2 ->
  batch 1 persisted, batch 3+ NOT attempted, summary `halted`, resumable message.

## Scope

- **In:** model-strategy flag + auto-fallback, stdout capture, PlannerUnavailableError
  classification, enrich circuit-break + resumable message.
- **Out:** parsing exact reset time from the banner; auto-switching to
  openai-responses (just recommend it); applying circuit-break to package/exec
  (single-call commands already surface the better message).
