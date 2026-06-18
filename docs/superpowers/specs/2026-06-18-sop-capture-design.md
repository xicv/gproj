# Design: SOP capture — procedural memory for gproj

**Date:** 2026-06-18
**Status:** Approved (design phase)
**Feature:** `gproj resources capture` — turn a work session into a reusable, classified, retrievable SOP resource card.

## Problem

When you debug something you tell the agent *where to look* — "check the DB like this, the browser like that, this data flow" — it solves it, then forgets. Next time the same class of issue arrives, you re-explain from scratch. The knowledge (facts established, environment touched, steps to reproduce, the fix) evaporates with the session.

gproj already has the retrieval half: resource cards with ranked `find`, `schema`, `index`, redaction, and cloud `sync`. What's missing is the **capture** half — a low-friction way to distill a session into an SOP card so the next similar issue is a `find` away, and the agent can re-run / confirm / ask to continue instead of starting over.

An existing skill (`/Users/xicao/Projects/skill-catcher`) does something similar but is **manual** (`/sc:start` -> work -> `/sc:end`) and **cannot capture retroactively** (its bookmark is set at `/sc:start` time). The manual ritual is easy to forget, so it goes unused. The fix is to make capture **automatic**.

## Research basis (2026)

- **Procedural memory** is the named concept: the 2026 long-running-agent memory stack is Working / Conversation / Episodic / Semantic / Knowledge-Graph / **Procedural** / Checkpoints. Procedural = "how to do things" (workflows, tool-use patterns, multi-step procedures) — described as the least-developed, highest-impact layer.
- **Episodic->procedural distillation**: after a task, evaluate whether the trajectory is "worthy of distillation into a new skill or refinement of an existing one"; distill from success and failure; quality-gate; refine, don't duplicate. (ERL, Memp, AutoSkill, CODESKILL, LEGOMem, Voyager.)
- **Secret/PII handling**: tiered detection — regex (sub-ms, structured secrets) -> entropy (high-entropy secrets) -> NER (PII, optional/later). Classify every field to a tier at design time and default to the most conservative tier until explicitly downgraded (allow-list). Redact at every boundary, not one.
- These map onto: automatic capture -> redacted digest -> quality gate -> classify -> distill -> SOP card; default **local** visibility, opt-in `shared`.

## Decisions (locked)

| Question | Decision |
|---|---|
| Capture trigger | **Auto (Claude Code Stop hook) + manual command** |
| Distiller | **gproj builds redacted digest; planner backend drafts the SOP at finalize** |
| Auto-capture flow | **Two-stage: Stop hook stores a PENDING digest (instant, local, no LLM/browser); `finalize` drafts the SOP later** |
| Capture gate | **Only substantive sessions** (>=N tool calls + a debug/feature/research signal) |
| Security default | **Local-only by default; opt-in `shared` to sync** |
| Card model | **Extend `ResourceCard`** (SOPs are resource cards) |
| Hook install | **`gproj resources capture install-hook`** edits `~/.claude/settings.json` (idempotent, with uninstall) |
| Secret handling | **Redact to source reference** (env var / Keychain / MCP name), never the value |
| Branch base | **Merge PR #6, branch `feat/resources-sop-capture` from main** |

## Flow

```
[session ends] -> Claude Code Stop hook -> `gproj resources capture --auto --session $CLAUDE_SESSION_ID`
     |  - locate transcript ~/.claude/projects/*/<session>.jsonl
     |  - slice lines since the per-session bookmark
     |  - build a REDACTED digest (steps, tool_sequence, fingerprint, environment, user_prompts, classification)
     |  - gate: proceed only if substantive (>=3 tool calls AND a debug/feature/research signal)
     |  - advance the bookmark; capture never throws into the hook (fail quiet, log)
     v
 PENDING capture  ->  .gproj/resources/pending/<captureId>.json   (local, no LLM, no browser)

[you]  gproj resources capture list                 # triage pending captures
[you]  gproj resources capture finalize <captureId> # planner drafts SOP from digest -> confirm kind/category -> resource card
[you]  gproj resources capture discard <captureId>
[you]  gproj resources capture                       # manual capture-now (same pipeline, current session)
```

The bookmark (`.gproj/resources/.capture-bookmark.json`, keyed by sessionId -> last transcript line) means every capture slices from the previous capture — no `/start` needed, nothing missed before you remembered.

## Classification (auto; confirmed/overridable at finalize)

Heuristic over the digest:
- **debug** — `is_error` tool results; DB/browser/log/dataflow inspection (sequel-mcp, chrome-devtools, mqtt, log reads); prompt verbs *fix / why / broken / error / failing*.
- **feature** — file `Edit`/`Write`/new files; verbs *add / implement / build*.
- **research** — `WebSearch`/`WebFetch`/read-heavy; verbs *understand / compare / how does / research*.

Pick the highest-signal class; ties -> `debug` (most actionable). The planner may override at finalize; the human confirms.

## Data model — `ResourceCard` extensions (Zod, `src/format/schema.ts`)

All optional, additive (existing cards stay valid):

```
kind         "debug"|"research"|"feature"|"reference"   default "reference"; capture sets debug/research/feature
facts        string[]    established truths from the session
environment  { db?: string[]; services?: string[]; mcp?: string[]; files?: string[]; urls?: string[] }
repro        string[]    ordered steps to reproduce the situation
resolution   string      what fixed it / what was concluded
triggers     string[]    when this SOP applies (phrases; complements intent + owns)
visibility   "local"|"shared"   default "local"
captureMeta  { sessionId: string; fingerprint: string; toolSequence: string[]; capturedAt: string }
```

Reuses existing `intent`, `owns`, `schemaSource`, `links`, `tags` — so ranked `find`, `schema`, and the `.okf-index.json` retrieve SOPs with no new retrieval code. A finalized SOP is just a resource card with `kind != reference`.

### Pending capture (`.gproj/resources/pending/<id>.json`)

```
id            captureId (slug from first prompt + short hash)
sessionId     Claude Code session id
capturedAt    ISO8601
classification "debug"|"research"|"feature"
digest        { steps[], toolSequence[], fingerprint, environment, userPrompts[], facts[] }  // all redacted
sourceLines   { from, to }   // transcript slice bounds, for provenance
```

## Components (small, single-purpose; new dir `src/resources/capture/`)

| Unit | File | Responsibility |
|---|---|---|
| Transcript | `src/resources/capture/transcript.ts` | locate `~/.claude/projects/*/<session>.jsonl`; slice since bookmark; parse user prompts, `tool_use`, `tool_result` (ok/error) |
| Digest | `src/resources/capture/digest.ts` | build steps/tool_sequence/fingerprint/environment/userPrompts/candidate-facts; run classification heuristic; apply the substantive-gate |
| Redaction | `src/resources/capture/redact.ts` | regex set (ported from skill-catcher) + entropy scan; redact to **source ref**; extend/compose existing `src/redact/sanitize.ts` |
| Pending store | `src/resources/capture/pending.ts` | read/write `pending/<id>.json`; manage `.capture-bookmark.json`; list/discard |
| Finalize | `src/resources/capture/finalize.ts` | pending digest -> planner draft (SOP fields) -> `ResourceCard` (kind/facts/env/repro/resolution/triggers) -> manifest + bundle regen |
| Hook installer | `src/resources/capture/hook.ts` | idempotent install/uninstall of the Stop entry in `~/.claude/settings.json`; print snippet |
| CLI dispatch | `src/commands/resources.ts` (extend) | `capture` (manual now), `capture --auto --session <id>`, `capture list`, `capture finalize <id>`, `capture discard <id>`, `capture install-hook [--uninstall]` |
| Journal events | `src/format/journal.ts` (extend) | `capture-pending`, `capture-finalized`, `capture-discarded` |

The Stop hook runs `gproj resources capture --auto --session $CLAUDE_SESSION_ID` in the repo cwd; if cwd is not a gproj repo, it exits 0 silently.

## Security

- **Redaction at both boundaries** — on capture (every digest field) and on finalize (drafted SOP body). Secrets become source references (`env:OPENAI_API_KEY`, `keychain:<entry>`, `mcp:<connection>`), never values.
- **Detection tiers (local, no network):** regex (PEM blocks, `user:pass@host`, `key=secret/token/password/api_key`, provider prefixes `sk-/ghp_/AIza/...`, AWS `AKIA...`, JWTs, `Authorization: Bearer`, mysql `-p<pw>`) -> entropy scan for loose high-entropy tokens.
- **`visibility` defaults `local`.** `gproj sync push` includes only `shared` cards; `pending/`, `.capture-bookmark.json`, and `local` cards are always excluded. Unclassified => treated as `local`.
- Capture writes only under `.gproj/`; never executes captured commands.

## Error handling

- `--auto` (hook) path: never throw — catch all, log to `.gproj/resources/pending/.capture.log`, exit 0, so a capture failure never breaks the user's session end.
- Manual path: actionable `throw new Error(...)` per gproj convention.
- `finalize`: planner failure -> leave the pending capture intact, clear error.
- Missing transcript / non-gproj cwd / empty slice -> no-op, exit 0.

## Testing (>=80%, mock-injected like existing suites)

- `transcript.test.ts` — parse JSONL fixtures; bookmark slicing; tool ok/error.
- `redact.test.ts` — secret corpus -> source-ref redaction; entropy catches.
- `digest.test.ts` — steps/fingerprint/environment; classification per signal mix; substantive-gate (rejects trivial).
- `pending.test.ts` — pending write/list/discard; bookmark advance.
- `finalize.test.ts` — mocked planner -> SOP card fields populated; dedup/refine vs existing SOP.
- `hook.test.ts` — idempotent settings.json install/uninstall (temp HOME).
- `resources.test.ts` — capture subverbs; `--auto` no-ops outside a gproj repo.
- sync test — `local`/pending excluded from push.

## Scope / phasing (planner will slice)

- **In v1:** auto+manual capture, redacted pending digest, classification, substantive gate, `capture list/finalize/discard`, SOP card fields, planner finalize, hook installer, local-default + sync exclusion.
- **Out of v1 (later):** NER-model PII (beyond regex+entropy); semantic SOP-dedup beyond fingerprint; multi-session merge; auto-finalize without human confirm; richer `environment` extraction from MCP schemas.

## Extension points

| Change | File |
|---|---|
| Card fields + pending schema | `src/format/schema.ts` |
| Paths (`pending/`, bookmark, capture log) | `src/format/paths.ts` |
| New capture modules | `src/resources/capture/*.ts` |
| Subverb dispatch | `src/commands/resources.ts` |
| Journal events | `src/format/journal.ts` |
| Sync exclusion of local/pending | `src/commands/sync.ts` / `src/backends/cloudSync.ts` |
| OKF projection of SOP fields | `src/resources/okf.ts` |
| Context-pack: surface SOPs (kind + triggers) | `src/assembler/pack.ts` |

## Codex review — incorporated changes (2026-06-18)

A second-opinion review (Codex) surfaced security leak paths and Stop-hook
reliability gaps. All folded into this spec:

### Security (HIGH)
- **Pending digest stores allow-listed structured extracts only.** Do NOT persist
  raw free-text user prompts / tool results. Redaction runs over tool *results*
  too (not just inputs), before any pending JSON is written. Low-entropy creds /
  ordinary PII in prompts must be deterministically scrubbed pre-write.
- **Mandatory redaction fallback.** When a detected secret has no provable source
  (e.g. a value from a DB row or tool result), redact to `[REDACTED:secret]` —
  never emit the value, never guess a source ref.
- **Sync is a shared-only projection.** `gproj sync push` must build its payload
  from a projection that contains ONLY `visibility:"shared"` cards; the generated
  OKF bundle (`resources/`) and `.okf-index.json` are NOT synced wholesale. A
  test asserts no `local`/pending SOP field appears in any sync payload.
- **finalize forces `visibility:"local"`** unless an explicit `--share` flag (or a
  confirm-shared prompt) is given. Planner-supplied visibility is ignored.

### Distillation safety (MEDIUM)
- **Treat the digest as untrusted data** going into the planner (prompt-injection
  risk). Zod-validate the planner's output into the SOP fields, ignore any
  planner-supplied `visibility`, and **re-run redaction on the drafted SOP body**
  after the planner returns.
- **v1 dedup/refine** = fingerprint + trigger/owns match. `finalize` presents an
  explicit choice: add new card, or refine the matched existing SOP (additive
  merge). No silent duplicate.
- **kind-specific minimum fields**: a finalized SOP with `kind:"debug"` requires
  `repro` + `resolution`; `feature`/`research` require `resolution` (or a
  documented conclusion). Legacy `reference` cards stay permissive. Validation at
  finalize, not on plain resource add.

### Stop-hook reliability (HIGH/MEDIUM)
- **Transcript stability before read.** The `--auto` path waits for the JSONL
  size+mtime to settle (or retries on partial-EOF) and only advances the bookmark
  through fully-parsed COMPLETE records — never mid-write.
- **Richer bookmark.** `.capture-bookmark.json` stores, per session: transcript
  path, last byte size, mtime, and a hash of the last consumed line — and resets
  safely on truncation / rotation / mismatch instead of mis-slicing.
- **Atomic, locked state.** Pending writes and bookmark updates use temp-file +
  rename under a per-session lock, so an overlapping manual + auto capture cannot
  corrupt state or double-create.
- **Pending provenance.** Pending records also store repo root, cwd, git
  branch+HEAD, and gproj version, so a delayed `finalize` can detect a stale or
  cross-repo capture and warn.
- **Skip is auditable.** When the substantive-gate rejects a slice, record a
  minimal redacted skip note (reason + line range) before advancing the bookmark,
  so a false-negative is recoverable rather than silently lost.
- **Failures are visible.** Persistent `--auto` capture errors (still exit 0 to
  the hook) are surfaced in `gproj resources capture list` and `doctor`, not only
  in `.capture.log`.

### Classification (NICE-TO-HAVE)
- Persist the per-class signal scores (debug/feature/research) on the pending
  record and display them at `finalize`, instead of collapsing to a single label
  before human review.
