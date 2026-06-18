# gproj

**A project brain for AI coding agents.** You set direction; a high-reasoning
*planner* plans and reviews; an *executor* (Codex / Claude Code) edits the code.
gproj remembers everything, verifies the work itself, captures what you learn,
and never touches your real code until you say so.

```bash
npm i -g @nickcao/gproj
```

> The bin command is `gproj`. Source: https://github.com/xicv/gproj

---

## Why it exists

You already use an AI coding agent. Four things keep hurting:

1. **It forgets.** Every session you re-explain the goal, the decisions, the dead ends.
2. **It grades its own homework.** "Done — tests pass." You re-run them. They don't.
3. **It edits your real tree while it experiments.** A half-baked attempt lands before you wanted it.
4. **Hard-won knowledge evaporates.** You debug something tricky, then re-derive it next month.

gproj is a thin layer over the model you already use. It is **not another model** —
it is durable memory, independent verification, a safety rail, and a growing
knowledge base your agent can search.

---

## What gproj gives you

| Pillar | What it does |
|---|---|
| **The loop** | `init → package → exec → review → decide` — plan, edit in a sandbox, verify, human gate. |
| **Resources** | A curated, categorized, cross-linked knowledge base (docs/links/PDFs/images) the planner can search by symbol, endpoint, or intent. |
| **SOP capture** | Automatically turn a debugging/work session into a reusable, redacted SOP card — credentials stay local. |
| **Agent-native** | `gproj catalog` + `gproj install-agent` make Claude and Codex fluent in gproj with zero rote. |

---

## 1. The loop (the whole mental model)

```
  you ──set direction──▶  init
                            │
            ┌───────────────┴───────────────┐
            ▼                                │
  package  →  exec  →  review  →  decide ────┘   then advance to next phase
 (plan the   (executor  (planner   (YOU: accept /
  phase)      edits in   critiques  adjust / reject)
              a sandbox)  evidence)
```

| Step | Who | What |
|------|-----|------|
| `init` | you | set the one-sentence goal |
| `package` | planner | turn goal + memory into a concrete phase instruction |
| `exec` | executor | make the edits **inside an isolated git worktree** |
| `review` | planner | critique the **verified** evidence (diff + tests) |
| `decide` | **you** | `accept` applies, `adjust` retries, `reject` discards |
| `advance` | — | runs package→exec→review, stops at your decide gate |

The rule that ties it together: **the executor proposes, gproj verifies, you
decide.** The model never marks its own work done; your codebase never changes
without your explicit `accept`. The executor's self-report is untrusted — gproj
runs git + your test command itself, and only its result counts.

## 2. Resources — a searchable project knowledge base

Stop re-pasting "the docs are here, the spec is there." Register reference
material once; the planner gets a pointer-only index every round and can fetch
specifics on demand. Stored as an **OKF v0.1** markdown bundle under `.gproj/`.

```bash
gproj resources organise docs/            # bulk-import a tree; category = subdir
gproj resources add api.md --category billing --tags api,stripe \
  --intent "billing webhooks" --owns-symbol StripeWebhook \
  --owns-endpoint "POST /webhooks/stripe" --schema-source src/billing.ts:StripeWebhook
gproj resources enrich --category billing # planner adds tags, ownership, and links
gproj resources find --limit 10 StripeWebhook  # ranked: symbol > endpoint > intent > tags > body
gproj resources schema <id>               # jump from the doc to the code definition (path:line)
gproj resources list | show <id> | link <a> defines <b> | rm <id> | doctor
gproj resources index                     # refresh the .okf-index.json cache
```

`find` ranks by what a card *owns* (symbols, endpoints, config keys), so
`gproj resources find "POST /webhooks/stripe"` returns the one doc that owns it.
Use `gproj resources find --all <query>` when you need the complete ranked set.

`enrich` is idempotent by default: it skips cards with `enrichedAt` unless
`--reenrich` is set, processes roughly 15 cards per planner call, and commits
each successful batch independently. Large repositories should scope by
`--category` or `--limit` first; runtime and cost scale with the number of
planner batches, and `--dry-run` shows the proposed batch changes without
writing `.gproj/`.

## 3. SOP capture — procedural memory from your sessions

You debug something, tell the agent where to look (DB, browser, data flow), it
fixes it — and normally that knowledge is gone. gproj captures it.

```bash
gproj resources capture install-hook      # one-time: auto-capture at session end
# ...work / debug as usual...
gproj resources capture list              # triage what was captured (redacted digests)
gproj resources capture finalize <id>     # planner drafts a reusable SOP card
gproj resources capture finalize <id> --share   # also allow it to sync (default: local)
gproj resources find <symbol|topic>       # next similar issue → your prior SOP
```

- **Automatic**: a Claude Code Stop hook captures substantive sessions; no manual
  start/stop. Trivial sessions are skipped.
- **Auto-classified** as `debug` / `research` / `feature`.
- **Redacted**: secrets become source refs (`env:NAME`) or `[REDACTED:secret]`,
  scrubbed before anything hits disk.
- **Local by default**: SOPs never sync unless you `--share` them.

## 4. Cloud sync (optional) — back up the brain to a ChatGPT Pro project

```bash
gproj sync push           # upload shared .gproj state to your ChatGPT project (via oracle)
gproj sync list           # show remote sources
gproj sync fetch <file>   # best-effort retrieve a file back (warns: not byte-exact; --force to overwrite)
```

Only `shared` resources sync; local SOPs, pending captures, and credentials never
leave your machine. Configure `cloudSync.chatgptUrl` in `.gproj/config.json`.

## 5. Make your agent fluent in gproj

gproj is **self-describing** — it documents its own commands, so the agent skill
never goes stale:

```bash
gproj catalog                     # human-readable command map
gproj catalog --json              # structured (for tools)
gproj catalog --intent "debug a flaky test"   # route an intent to commands
gproj install-agent               # install the operator skill for Claude + Codex (global)
gproj install-agent --project     # committed/team scope (repo .claude/skills + AGENTS.md)
gproj install-agent --uninstall
```

`install-agent` writes a thin operator skill (Claude `SKILL.md`) and a managed
`AGENTS.md` block (Codex) that point the agent at `gproj catalog` / `gproj <cmd>
--help` — so Claude or Codex can discover and run everything without you
memorizing it.

---

## Real-world cheat sheet

| You want to… | Run |
|---|---|
| Start a tracked goal | `gproj init "Ship onboarding flow"` |
| Do one safe round (plan→edit→verify, stop at your gate) | `gproj advance` then `gproj decide accept` |
| See where you are | `gproj status` |
| Retry a phase with feedback / throw it away | `gproj decide adjust` / `gproj decide reject` |
| Recover after a crash | `gproj recover` · `gproj doctor` |
| Organize scattered docs into the knowledge base | `gproj resources organise docs/` |
| Enrich imported docs for ownership and links | `gproj resources enrich --category docs` |
| Find the doc that owns a symbol / endpoint | `gproj resources find PaymentIntent` |
| Jump from a doc to the code it documents | `gproj resources schema <id>` |
| Turn on automatic SOP capture | `gproj resources capture install-hook` |
| Save a debugging session as a reusable SOP | `gproj resources capture finalize <id>` |
| Reuse a past fix for a recurring issue | `gproj resources find "<the symptom/symbol>"` |
| Share a procedure to your ChatGPT project | `finalize <id> --share` then `gproj sync push` |
| Teach Claude/Codex to drive gproj | `gproj install-agent` |
| List every command (always current) | `gproj catalog` |

### End-to-end: a recurring bug

```bash
gproj resources capture install-hook         # once, globally
# bug reported → you debug it with your agent (check DB, logs, repro)
gproj resources capture list                 # the session was captured + redacted
gproj resources capture finalize <id>        # → an SOP card: facts, environment, repro, fix
# weeks later, similar bug:
gproj resources find "<error or symbol>"     # → your SOP; agent re-runs / confirms instead of re-deriving
```

---

## Configuration

Optional `.gproj/config.json` (gproj scaffolds a default on `init`):

```json
{
  "testCommand": ["npm", "test"],
  "typecheckCommand": ["npx", "tsc", "--noEmit"],
  "plannerBackend": "oracle-browser",
  "executorBackend": "codex",
  "sandbox": { "mode": "worktree" },
  "cloudSync": { "chatgptUrl": "https://chatgpt.com/g/g-p-.../project" }
}
```

**Backends**

| Role | Options |
|------|---------|
| Planner | `stub` · `oracle-browser` (ChatGPT Pro via browser, no API key) · `openai-responses` (needs `OPENAI_API_KEY`) |
| Executor | `stub` · `codex` · `claude-code` |

Override per-run with `GPROJ_PLANNER` / `GPROJ_EXECUTOR`. Precedence:
`env > .gproj/config.json > default`.

---

## Commands

```
# the loop
gproj init "<goal>"                 start a project brain in the current repo
gproj package | exec | review       plan / run executor (sandbox) / critique evidence
gproj decide accept|adjust|reject   the human gate
gproj advance                       package → exec → review in one step
gproj status | doctor | recover     state / diagnose / clean up after a crash

# resources (knowledge base)
gproj resources organise [dir] [--dry-run] [--delete] [--category <category>]
gproj resources add <path> [--category --tags --title --type --intent --owns-* --schema-source --link]
gproj resources enrich [--category <category>] [--limit <n>] [--dry-run] [--reenrich]
gproj resources find [--limit <n>|--all] <query> | schema <id> | list | show <id> | link <a> <rel> <b> | rm <id> | index | doctor

# SOP capture (procedural memory)
gproj resources capture [--auto --session <id>] | list | finalize <id> [--share] | discard <id>
gproj resources capture install-hook [--project|--global] [--uninstall]

# cloud sync (optional)
gproj sync push | list | status | fetch <file...> [--force]

# agent enablement
gproj catalog [--json] [--intent <text>]
gproj install-agent [--global|--project] [--claude] [--codex] [--uninstall]
```

Run `gproj catalog` for the always-current list.

---

## Architecture, in plain terms

| Piece | What it is | Why it matters |
|---|---|---|
| **`.gproj/` on disk** | goal, plan, decisions, runs, resources, SOPs, state | the brain that survives sessions, tools, reboots |
| **Context assembler** | budget-bounded pack each round | feeds the planner what fits; never drops goal / phase / latest evidence |
| **Planner / Executor backends** | the reasoning model / the code editor | swap freely without losing state |
| **Sandbox (git worktree)** | executor edits land in isolation | nothing touches real code until you accept |
| **Verifier** | gproj runs git + your tests itself | the source of truth for "did it pass" |
| **Resources + OKF bundle** | searchable knowledge base + SOPs | the agent finds prior work instead of re-deriving it |

---

## Install from source

```bash
git clone https://github.com/xicv/gproj && cd gproj
npm install
npm run build
npm link            # puts the `gproj` command on your PATH
```

MIT licensed.
