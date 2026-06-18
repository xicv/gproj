# Design: resources enrich — turn imported docs into a relational knowledge graph

**Date:** 2026-06-18
**Status:** Approved (design phase)
**Feature:** `gproj resources enrich` + text-format detection + `find --limit` + organise category fallback.

## Problem

Dogfooding `organise` on a real repo (253 docs) showed: import + ranked `find`
work well, but `organise` only fills `category` (from folder) + `body`. Every
semantic field is empty (`tags:[] intent:None owns:None schemaSource:None
links:None`). So topics don't cluster (94 files in one `root` bucket), there are
no relations between docs, and `schema` (code locations) is dead. The tool finds
a doc by keyword but cannot "figure out the relations of the details."

Also: text formats like `.mmd` (mermaid — the actual flow diagrams), `.sh`,
`.csv`, `.json` import as binary, so their content is unsearchable; and `find`
returns every hit with no cap.

## Research basis

- Google OKF ships an **enrichment agent** reference impl — an LLM pass that adds
  metadata to a knowledge bundle. 2026 episodic->procedural distillation: an LLM
  analyses a corpus and extracts reusable structure (topics, relations).
- This is the missing "enrich" half: import is mechanical; enrich is the LLM pass
  that infers topic categories, tags, intent, owns, code pointers, and links.

## Decisions (locked)

| Question | Decision |
|---|---|
| Core feature | `gproj resources enrich` — planner pass over imported cards |
| Distiller | the existing planner backend (oracle/openai), batched |
| Trust | digest/cards are untrusted into the planner; Zod-validate output; redact new text |
| Scope control | `--category`, `--limit`, `--dry-run`, default = cards missing enrichment |
| Smaller fixes | text-extension detection; `find --limit`; organise category fallback |

## Components

| Unit | File | Responsibility |
|---|---|---|
| Enrich engine | `src/resources/enrich.ts` (new) | batch cards (~15/call); build a prompt with each card's title+excerpt + the list of all card ids/titles as link targets; call planner; Zod-validate per-card output `{category?, tags[], intent?, owns{}, schemaSource[], links[{rel,toId}]}`; redact new text; merge into manifest; regen bundle |
| CLI | `src/commands/resources.ts` (extend) | `enrich [--category C] [--limit N] [--dry-run] [--reenrich]`; `find [--limit N] [--all]` |
| Text detection | `src/resources/import.ts` (extend) | TEXT_EXTENSIONS set (.md .mmd .txt .sh .csv .json .yaml .yml .ts .js .tsx .jsx .py .go .rs .toml .ini .xml .html .css ...) -> import as body, not binary |
| Category fallback | `src/resources/organise.ts` (extend) | scan-root files get category from the scanned dir's basename (e.g. `vendor`), not generic `root`; `--category` still overrides |
| Catalog entry | `src/catalog.ts` (extend) | add `resources enrich` entry (anti-rot test requires it) |
| Schema marker | `src/format/schema.ts` (extend) | optional `enrichedAt` ISO timestamp on ResourceCard so `enrich` can skip already-enriched cards unless `--reenrich` |

## Enrich flow

```
gproj resources enrich [--category C] [--limit N] [--dry-run]
  select cards: missing enrichedAt (or all in --category), capped by --limit
  for each batch of ~15:
    prompt = per-card {id,title,excerpt} + global {id->title} index for link targets
    planner -> JSON: per card { category?, tags[], intent?, owns{symbols,endpoints,configKeys}, schemaSource[], links[{rel,toId}] }
    Zod-validate; drop unknown toId links; redact text fields; ignore any visibility/secret
  --dry-run: print proposed enrichment, write nothing
  else: merge into manifest (set enrichedAt), regen OKF bundle + index, journal `resources-enriched`
```

Links are bidirectional-aware via `doctor` (existing dangling-link check covers
unknown targets). `owns`/`schemaSource` feed the existing ranked `find` + `schema`
so enriched topics become retrievable by symbol/endpoint immediately.

## Security

Enrichment text comes from the user's own docs, but treat planner output as
untrusted: Zod-validate, redact new text fields with the existing redactor,
ignore any planner-supplied visibility. Enrich never executes anything and writes
only under `.gproj/`. Default visibility of cards is unchanged (enrich does not
flip local/shared).

## Error handling

- A failed planner batch logs + skips that batch (other batches still apply);
  clear summary of enriched / skipped counts.
- `--dry-run` writes nothing. Unknown `toId` in a proposed link is dropped, not
  fatal. Empty corpus -> no-op.

## Testing (>=80%, mock-injected planner)

- enrich: mocked planner -> tags/intent/owns/schemaSource/links merged onto cards;
  `enrichedAt` set; `--limit`/`--category` scoping; `--dry-run` writes nothing;
  unknown-toId link dropped; planner-output Zod-validation rejects malformed.
- import: text extensions (.mmd/.sh/.csv/.json) -> body present, type text.
- find: `--limit N` caps output; `--all` returns full; ranking unchanged.
- organise: scan-root fallback category = dir basename, not `root`.
- catalog anti-rot: `resources enrich` present.

## Scope / phasing

- **In v1:** enrich (planner, batched, scoped, dry-run, validated), text detection,
  find --limit, category fallback, enrichedAt marker.
- **Out of v1:** auto-enrich on organise (keep it an explicit step for cost
  control); semantic dedup/merge of near-duplicate cards; image/OCR enrichment.
