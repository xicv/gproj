# Design: `gproj resources` — curated, categorized reference material for the planner

**Date:** 2026-06-17
**Status:** Approved (design phase)
**Feature:** `resources` (verb: `organise`)

## Problem

An AI coding agent works better when it knows *where* the project's reference
material lives — design docs, vendored specs, task definitions, diagrams, PDFs,
recorded demos. Today that material is scattered (e.g. a repo's `.vendor/` and
`.projecttaks/` dirs holding dozens of related task and spec files) with no
index, no grouping, and no machine-readable pointer the planner can consult.

gproj already assembles a budget-bounded **context pack** for the planner each
round. It has durable memory (`GOAL.md`, `decisions.ndjson`, `known-issues.ndjson`,
`architecture.md`) but **no concept of external reference material**. This feature
adds one: a curated, categorized, cross-linked manifest of resources that is
surfaced to the planner as a compact pointer-index, so it knows where to look
when checking, debugging, or building features on top of existing knowledge.

## Research basis (2026)

- **Google Cloud Open Knowledge Format (OKF) v0.1**, published 2026-06-12: a
  vendor-neutral spec — a directory of markdown files with YAML frontmatter —
  for turning scattered org knowledge into agent-ready bundles. Reserved fields:
  `type` (required), `title`, `description`, `resource`, `tags`, `timestamp`.
  Cross-links are plain markdown links, which turn the directory into a graph.
  Identity = file path. Optional `index.md` (progressive disclosure), `log.md`
  (history). Minimally opinionated: producers add their own fields.
  Repo: https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf
- **Context engineering / just-in-time retrieval:** surface *pointers, not
  payloads*. Dumping whole corpora into context is wasteful ("context arson");
  the planner should see *where* to find things and fetch specifics on demand.
- **File-based memory > vector DB for this tier:** the resource set is small,
  curated, and stable, so a file manifest (like `CLAUDE.md`/`AGENTS.md`) is the
  right tool — not RAG/embeddings, which suit large or dynamic corpora.

This feature adopts OKF as its on-disk *interop/export* format and applies the
just-in-time pointer principle to context-pack injection.

## Decisions (locked)

| Question | Decision |
|---|---|
| Material reference model | **Import into `.gproj/`** (gproj owns the bundle); `organise` can delete duplicate originals after import |
| Organization | **Category + free tags** (category = subdir; tags = frontmatter), aligned to OKF |
| Connections depth | **Explicit typed links** between resources (a lightweight knowledge graph) |
| Surfacing to planner | **Compact pointer-index, always injected** into the context pack |
| Source of truth | **A: `resources.ndjson` canonical + OKF markdown bundle generated on write** (zod-only, no new dependency) |
| Delete safety | **Dry-run by default; `--delete` flag required**, and only removes originals that were skipped as **pre-existing** duplicates (never files imported this run), re-hashed immediately before `unlink` |

## Codex review — incorporated changes

A second-opinion review (Codex, 2026-06-17) surfaced several issues now folded
into this spec:

- **`--delete` must not delete files imported in the same run.** Delete candidates =
  only files skipped because an identical-hash card *already existed before this run*.
  Re-stat + re-hash each candidate immediately before `unlink` (TOCTOU guard);
  never touch anything under `.gproj/`.
- **Default `organise` excludes** `.gproj`, `.git`, `node_modules`, `dist`, `build`,
  and the generated bundle path — so repeated runs never re-ingest themselves.
- **`.md`/text files import as card *body/excerpt*, not as opaque binary assets.**
  Binaries (image/pdf/video) import as assets the card `resource:` points to.
- **Schema gains `body`/`excerpt`** so `find` can search content and text-only
  planner backends (e.g. `openai-responses`, which sends no file tools) still get
  usable substance, not just dead pointers.
- **Provenance preserved:** a card keeps `sourcePaths[]` (all observed origins) so
  dedup across paths/categories does not lose where material came from.
- **Generated bundle is transactional + read-only:** render into a temp dir,
  validate, atomically swap after the manifest write; mark generated card files
  read-only and document an `import-okf` upgrade path so human edits to the bundle
  are not silently clobbered.
- **Lock only mutating subverbs** (`list`/`show`/`find` are read-only).
- **Content-addressed asset names** (`<id>-<shorthash>.ext`); hard-refuse overwrite.
- **Manifest reads use a dedicated zod `safeParse` parser** with line-numbered errors.
- **Links store `toId` internally**; the OKF projection renders canonical
  bundle-relative markdown links from it.
- **`doctor` gains checks** for dangling links, missing local assets, `contentHash`
  drift, duplicate ids, and generated-bundle drift.

## Architecture

`.gproj/resources/` is an **OKF v0.1 bundle** projected from a canonical NDJSON
manifest:

```
.gproj/
├── resources.ndjson                # CANONICAL manifest (one ResourceCard per line)
└── resources/                      # GENERATED OKF bundle (projection; safe to delete & regenerate)
    ├── index.md                    # category → card list (OKF progressive disclosure)
    └── <category>/                 # category = directory
        ├── index.md
        ├── <id>.md                 # OKF card: frontmatter + body + "## Related" links
        └── _assets/<file>          # imported binaries; card `resource:` points here
```

- **`resources.ndjson` is the source of truth.** Reads (context pack, list,
  find, show) parse it with zod — fast, validated, no YAML dependency. Matches
  the existing `decisions.ndjson` / `known-issues.ndjson` append-pattern, but
  resources are mutable (link/rm), so writes rewrite the file atomically rather
  than append-only.
- **The OKF bundle under `resources/` is a generated projection**, rewritten on
  every mutation. It exists for human browsing and OKF-tool interop. Hand-edits
  to cards do **not** round-trip back into the manifest in v1 (documented
  limitation; upgrade path is approach B — make cards canonical + add `yaml`).

### Data model — `ResourceCard` (Zod, `src/format/schema.ts`)

```
id           string   slug, stable, unique; used as link target          (gproj)
type         string   required — "doc"|"link"|"image"|"pdf"|"video"|...  (OKF, only required field)
title        string   human name                                         (OKF)
description  string?  one-line summary                                   (OKF)
category     string   grouping → subdir name                             (gproj)
tags         string[] free labels                                        (OKF)
resource     string?  rel asset path (e.g. dji/_assets/x-ab12cd.pdf) OR URL  (OKF)
body         string?  text content (md/text imports) — rendered as card body         (gproj)
excerpt      string?  bounded summary/first-N-chars, used in find + text-only packs   (gproj)
sourcePaths  string[] all observed origin paths (provenance; survives dedup)          (gproj)
links        { rel: "defines"|"references"|"relates-to"|"depends-on", toId: string }[]   (gproj typed graph)
contentHash  string?  sha256 of imported file content (node:crypto), for dedup         (gproj)
timestamp    string   ISO8601 last-modified                              (OKF)
```

`category` and `id` are slugified (lowercase, `[a-z0-9-]`). Link `to` references
another card's `id`; a link to a missing id is a validation warning, not a hard
error (surfaced by `doctor`/`show`). Both frontmatter `links:` and a rendered
`## Related` markdown-link section are written to each card, so the bundle is a
valid OKF graph *and* gproj keeps typed relations.

### Components (each small, single-purpose)

| Unit | File | Responsibility |
|---|---|---|
| Schema + types | `src/format/schema.ts` (extend) | `ResourceCardSchema`, `ResourceLinkSchema`, inferred types |
| Paths | `src/format/paths.ts` (extend) | `resourcesManifestPath`, `resourcesBundleDir`, `resourceCardPath`, `resourceAssetDir` |
| Manifest store | `src/resources/manifest.ts` (new) | read/parse/validate, atomic rewrite of `resources.ndjson`; pure functions over `ResourceCard[]` (add/update/remove/find) |
| Importer | `src/resources/import.ts` (new) | detect type from extension, copy file into `_assets/`, compute sha256, build a `ResourceCard`; resolve URL vs path |
| Dedup | `src/resources/dedup.ts` (new) | find originals whose sha256 matches a card; report duplicates |
| OKF projection | `src/resources/okf.ts` (new) | render a `ResourceCard` → markdown card; regenerate full `resources/` bundle + `index.md` from manifest |
| Command dispatch | `src/commands/resources.ts` (new) | sub-verb router (mirrors `sync.ts`): add / organise / list / show / find / link / rm |
| CLI wiring | `src/cli.ts` (extend) | `case "resources"` under `withLock`; add to usage string |
| Context injection | `src/assembler/pack.ts` (extend) | `RESOURCES` section, priority 75, pointer-only |
| Journal events | `src/format/journal.ts` (extend) | `resource-added`, `resources-organised`, `resource-linked`, `resource-removed` |

### Commands (sub-verb dispatch — same pattern as `src/commands/sync.ts`)

```
gproj resources add <path|url> [--type T] [--title S] [--category C] [--tags a,b] [--link rel:id]
gproj resources organise [dir] [--dry-run] [--delete] [--category C]
gproj resources list [--category C] [--tag t]
gproj resources show <id>
gproj resources find <query>
gproj resources link <fromId> <rel> <toId>
gproj resources rm <id>
```

- **`add`** — import one file or register one URL. Copies file into the
  category's `_assets/`, computes hash, writes a card, regenerates the bundle.
- **`organise [dir]`** — the headline verb. Scans `dir` (default: cwd) for
  candidate files (`.md .pdf .png .jpg .jpeg .gif .svg .webp .mp4 .mov .webm`),
  imports each into the manifest, **dedupes by `contentHash`** (identical content
  imported once). **Default is dry-run**: prints what *would* be imported and
  which originals are byte-identical duplicates of imported cards. Only with
  **`--delete`** does it remove those duplicate originals — and only originals
  whose hash matches a card now in the manifest. `--category` sets the category
  for everything found (default: derived from the source subdir name).
- **`list` / `show` / `find`** — read-only (no lock). `find` is a substring/token
  match over title, description, tags, and card body.
- **`link <from> <rel> <to>`** — add a typed edge to the `from` card's `links`.
- **`rm <id>`** — remove a card, its asset, and inbound links to it; regenerate.

### Data flow — `organise`

```
scan dir (EXCLUDING .gproj/.git/node_modules/dist/build/bundle) → for each candidate file:
    compute sha256
    hash matches a card that existed BEFORE this run?
        yes ──▶ add path to that card's sourcePaths; mark file as pre-existing duplicate (delete candidate)
        no  ──▶ import (text→body/excerpt, binary→content-addressed asset), build card, add to manifest
rewrite resources.ndjson (atomic, zod-validated)
regenerate resources/ OKF bundle into temp dir → validate → atomic swap (generated files read-only)
--delete?  ── yes ──▶ for each pre-existing-duplicate file: re-stat + re-hash; unlink only if still matches
           no  ──▶ print duplicates that WOULD be deleted with --delete (dry-run default)
append journal: resources-organised
return renderStatus(root)
```

### Context-pack integration (`src/assembler/pack.ts`)

A new `RESOURCES` section, **priority 75** (between `ARCHITECTURE` 80 and
`DECISIONS` 70), budget-bounded like every other section. **Pointer-only — never
card bodies or asset contents.** Format, grouped by category:

```
## Resources
### dji-cloud-api
- MQTT Thing Model (doc) → dji-cloud-api/_assets/thing-model.md  #mqtt #definition  [defines: controller-fallback]
- Cloud API Protocol v3 (pdf) → dji-cloud-api/_assets/protocol-v3.pdf  #spec
```

The planner sees titles, types, where the artifact lives, tags, and typed links,
then fetches specifics on demand. The section is **pre-truncated by entry/category
count** to a fixed small cap *before* being handed to `planBudget` (so the index
can't balloon past its slice), with a `(+N more)` marker. Goal/phase/evidence are
never displaced. Because some planner backends are text-only (`openai-responses`
sends no file-read tools), each entry may carry the card's bounded `excerpt` so a
pointer is never dead — but never the full `body` or asset contents. Priority 75
sits above DECISIONS(70); to avoid starving decisions/known-issues on a large
manifest the resources cap is small and fixed rather than competing freely.

## Error handling

- All errors: `throw new Error("<actionable message>")`, per gproj convention;
  `main()` in `cli.ts` prints `e.message` and exits 1. Usage errors → `CliExit(2)`.
- State guard: require `readState(root)` (gproj initialized) before mutations.
- `add`/`organise`: missing path, unreadable file, unknown extension → clear error.
- `--delete` only ever unlinks files whose sha256 matches a card in the manifest;
  never deletes anything inside `.gproj/`; never deletes a non-duplicate.
- `link`: unknown `from`/`to` id → error; unknown `rel` → error listing valid rels.
- Dangling links (target later removed) → warning in `show`/`doctor`, not a throw.

## Testing (target ≥80%)

- `tests/format/resourceSchema.test.ts` — schema validation, slugify, link enum.
- `tests/resources/manifest.test.ts` — add/update/remove/find pure functions;
  atomic rewrite; round-trip parse.
- `tests/resources/import.test.ts` — type detection, asset copy, sha256.
- `tests/resources/dedup.test.ts` — identical content deduped; distinct kept.
- `tests/resources/okf.test.ts` — card markdown has valid frontmatter + `## Related`;
  `index.md` lists categories; bundle regenerates idempotently.
- `tests/commands/resources.test.ts` (mirror `sync.test.ts`) — each sub-verb;
  `organise` dry-run prints duplicates and deletes nothing; `--delete` removes
  only hash-matched originals.
- `tests/assembler/resourcesPack.test.ts` — pointer-only injection, priority 75,
  budget truncation, no payloads leak.

## Scope / YAGNI

**In v1:** import, categorize, tag, typed links, text find, OKF bundle export,
compact context injection, safe dedup-delete.

**Out of v1 (noted upgrade paths):** markdown-as-source-of-truth + `yaml` dep
(approach B); embeddings/semantic search; graph-traversal queries beyond direct
links; remote/URL content fetching; cloud sync of the bundle (could later extend
the existing `sync` command).

## Extension points (from codebase map)

| Change | File | Anchor |
|---|---|---|
| `case "resources"` + usage string | `src/cli.ts` | switch at ~L46; default/usage at ~L126 |
| Path helpers | `src/format/paths.ts` | after last export (~L23) |
| Zod schema + types | `src/format/schema.ts` | end of file (~L43) |
| Context-pack section | `src/assembler/pack.ts` | between ARCHITECTURE/DECISIONS (~L86–95) |
| Journal events | `src/format/journal.ts` | `JournalEvent` union (~L4–14) |
| New modules | `src/resources/*.ts` | new dir |
| Tests | `tests/resources/*`, `tests/commands/resources.test.ts` | mirror existing |
```
