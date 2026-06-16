# gproj

**A project brain for AI coding agents.** You set direction, a high-reasoning
*planner* plans and reviews, an *executor* (Codex / Claude Code) edits the code
— and gproj remembers everything, verifies the work itself, and never touches
your real code until you say so.

```bash
npm i -g @nickcao/gproj
```

> The bin command is `gproj`. Source: https://github.com/xicv/gproj

---

## Why it exists

You already use an AI coding agent. Three things keep hurting:

1. **It forgets.** Every session you re-explain the goal, the decisions, the
   dead ends. Context evaporates.
2. **It grades its own homework.** "Done — tests pass." You re-run them. They
   don't.
3. **It edits your real tree while it experiments.** A half-baked attempt is in
   your working directory before you decided you wanted it.

gproj is a thin layer that fixes all three. It is **not another model** — it's
the durable memory, the independent verification, and the safety rail around
the model you already use.

> Pair-programming with someone who has amnesia → vs → working with someone who
> keeps a project notebook, runs the tests *before* claiming victory, and writes
> on a scratch copy until you say "ship it."

---

## A real scenario

Building a "meeting agent" — three days of work, bouncing between Codex (fast
edits) and Claude Code (trickier reasoning).

**Without gproj:** each morning you paste the goal again, re-explain yesterday's
data-model decision, re-hit the dead end you already found. "Tests green" — you
re-run them. A bad experiment — `git checkout .` to claw your tree back.

**With gproj:**

```bash
cd meeting-agent                 # your git repo
gproj init "Summarize calls and file action items"

# Plan → edit (sandboxed) → review, one phase. Planner = your ChatGPT Pro
# browser (no API key); executor = Codex.
GPROJ_PLANNER=oracle-browser GPROJ_EXECUTOR=codex gproj advance

gproj status                     # where are we? what's next?
gproj decide accept              # YOU approve — only now does real code change
```

Day two: different laptop, switch the executor to Claude Code — gproj still
knows the goal, the phase, the decisions, and what failed. You never re-explain.

---

## The loop (the whole mental model)

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
| `review` | planner | critique the **verified** evidence |
| `decide` | **you** | `accept` applies, `adjust` retries, `reject` discards |
| `advance` | — | runs package→exec→review, stops at your decide gate |

One phase at a time. A human gate between each.

---

## How it helps everyday development

- **You stop re-explaining.** `.gproj/` holds the goal, plan, decisions, known
  issues, and every run. A budget-bounded "context pack" is assembled each
  round — the essentials (goal, phase, latest evidence) are *never* trimmed.
- **You can trust "tests pass" again.** The executor's self-report is
  **untrusted** (`executorClaims`). gproj runs git + your test command *itself*,
  and only its own result counts. The model can't grade its own homework.
- **Experiments can't wreck your tree.** The executor works in a throwaway git
  worktree. `reject` discards it; your real code was never touched. Only
  `accept` applies — atomically, and only after gproj checks your repo hasn't
  moved underneath it.
- **It's tool-agnostic.** Swap planner and executor backends freely — ChatGPT
  Pro browser today, Codex or Claude Code as the hands — without losing state.
- **It's recoverable.** Atomic writes + a repo lock + a run journal survive a
  crash mid-run; `gproj recover` cleans up and `gproj doctor` diagnoses.

---

## Architecture, in plain terms

| Piece | What it is | Why it matters |
|---|---|---|
| **`.gproj/` on disk** | plan, decisions, known issues, per-run records, state | the brain that survives sessions, tools, reboots |
| **Context assembler** | builds a budget-bounded pack each round | feeds the planner what fits; never drops goal / phase / latest evidence |
| **Planner backend** | the reasoning model | clarifies, plans, reviews — the "brain" |
| **Executor backend** | the code editor | does the actual edits — the "hands" |
| **Sandbox (git worktree)** | executor edits land in isolation | nothing touches real code until you accept |
| **Verifier** | gproj runs git + your tests itself | the source of truth for "did it pass" |
| **State machine** | `init → planning → packaged → executing → reviewing → deciding` | one phase at a time, human gate enforced |

The rule that ties it together: **the executor proposes, gproj verifies, and you
decide.** The model never marks its own work done, and your codebase never
changes without your explicit `accept`.

---

## Configuration

Optional `.gproj/config.json` in your repo:

```json
{
  "testCommand": ["npm", "test"],
  "typecheckCommand": ["npx", "tsc", "--noEmit"],
  "plannerBackend": "oracle-browser",
  "executorBackend": "codex",
  "sandbox": { "mode": "worktree" }
}
```

**Backends**

| Role | Options |
|------|---------|
| Planner | `stub` · `oracle-browser` (ChatGPT Pro via browser, no API key) · `openai-responses` (needs `OPENAI_API_KEY`) |
| Executor | `stub` · `codex` · `claude-code` |

Override per-run with `GPROJ_PLANNER` / `GPROJ_EXECUTOR` env vars. Precedence is
`env > .gproj/config.json > default`.

---

## Commands

```
gproj init "<goal>"          start a project brain in the current repo
gproj package                plan the current phase
gproj exec                   run the executor (in a sandbox)
gproj review                 planner critiques the verified evidence
gproj decide accept|adjust|reject   the human gate
gproj advance                package → exec → review in one step
gproj status                 phase + next step
gproj doctor                 diagnose configuration / state
gproj recover                clean up after a crashed run
```

---

## Install from source

```bash
git clone https://github.com/xicv/gproj && cd gproj
npm install
npm run build
npm link            # puts the `gproj` command on your PATH
```

MIT licensed.
