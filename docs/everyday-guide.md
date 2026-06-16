# gproj — the everyday guide

A plain-language tour of what gproj is, why you'd reach for it, and how it
changes day-to-day work with AI coding tools. (For the terse command list see
the [README](../README.md).)

---

## The problem it actually solves

You use an AI coding agent — Codex, Claude Code, whatever. Three things keep
hurting:

1. **It forgets.** Every new session you re-explain the goal, the decisions you
   already made, the things that already failed. The context evaporates.
2. **It lies (cheerfully).** "Done — all tests pass." You run them yourself.
   They don't. The agent graded its own homework.
3. **It edits your real code while it thinks out loud.** A half-baked attempt
   is already in your working tree before you decided you wanted it.

gproj is a thin **"project brain"** that wraps any executor and fixes those
three things. It is not another AI model. It is the durable memory, the
verification, and the safety rail around the model you already use.

Think of it as the difference between *pair-programming with someone who has
amnesia* and *working with someone who keeps a project notebook, runs the tests
before claiming victory, and writes on a scratch copy until you say "ship it."*

---

## A real scenario

You're building a "meeting agent" feature. It's three days of work, and you
bounce between Codex (fast edits) and Claude Code (trickier reasoning).

**Without gproj:** each morning you paste the goal again, remind it what you
decided about the data model yesterday, and re-discover the dead end you
already hit. When it says "tests green," you re-run them. When an experiment
goes sideways, you `git checkout .` to claw your working tree back.

**With gproj:**

```bash
gproj init "Build a meeting agent that summarizes calls and files action items"
```

That writes a `.gproj/` folder — the project's brain on disk. From then on:

```bash
# Plan + execute + review one phase. Planner = your ChatGPT Pro browser
# (no API key), executor = Codex.
GPROJ_PLANNER=oracle-browser GPROJ_EXECUTOR=codex gproj advance

gproj status        # where are we? what's next?
gproj decide accept # you, the human, approve this phase's changes
```

Day two you switch laptops, switch to Claude Code as executor — and gproj still
knows the goal, the phase, the decisions, and what failed. You never re-explain.

---

## The loop (the whole mental model)

```
  you ──set direction──▶  init
                            │
            ┌───────────────┴───────────────┐
            ▼                                │
  package  →  exec  →  review  →  decide ────┘  advance to next phase
 (plan the   (executor  (planner   (YOU accept /
  phase)      edits in   critiques  adjust / reject)
              a sandbox)  evidence)
```

- **package** — the planner (the "brain": GPT-5 Pro, etc.) turns the current
  goal + memory into a concrete instruction for this phase.
- **exec** — the executor (the "hands": Codex / Claude Code) does the edits,
  **inside an isolated git worktree** — not your real files.
- **review** — the planner critiques the *verified evidence* (see below).
- **decide** — **you** gate it: `accept` applies the changes, `adjust` asks for
  another pass, `reject` throws them away. Your real code only changes on
  `accept`.
- **advance** runs package→exec→review in one go and stops at your decide gate.

One phase at a time. A human gate between each. That cadence is the point.

---

## How it helps everyday development

**You stop re-explaining.** `.gproj/` is the persistent memory: the goal, the
plan, every decision, known issues, and a record of each run. A bounded
"context pack" is assembled each round — the important parts (goal, current
phase, latest run evidence) are *never* dropped, even when older detail is
trimmed to fit the budget.

**You can trust "tests pass" again.** The executor's self-report is treated as
**untrusted** — gproj records it as `executorClaims` and ignores it for the
verdict. gproj runs git + your configured test command **itself**, and only
*its own* result sets `testsPassed`. The model can't grade its own homework.

**Experiments can't wreck your tree.** The executor works in a throwaway git
worktree. If the attempt is bad, `reject` discards it and your real code was
never touched. Only `decide accept` applies the change — atomically, and only
after gproj checks your repo hasn't moved underneath it (so a stale patch can't
corrupt your tree).

**It's tool-agnostic.** Planner and executor are swappable backends. Use your
ChatGPT Pro browser session as the planner (no API key needed), Codex as the
executor today, Claude Code tomorrow — the project state doesn't care.

**It's recoverable.** Atomic writes + a repo lock + a run journal mean a crash
mid-run doesn't corrupt state; `gproj recover` cleans up and `gproj doctor`
tells you what's wrong.

---

## The architecture, in plain terms

| Piece | What it is | Why it matters |
|---|---|---|
| **`.gproj/` on disk** | plan, decisions, known issues, per-run records, state | the brain that survives sessions, tools, and reboots |
| **Context assembler** | builds a budget-bounded "pack" each round | feeds the planner what fits; never drops goal / phase / latest evidence |
| **Planner backend** | the reasoning model (`oracle-browser` = ChatGPT Pro, `openai-responses`, `stub`) | clarifies, plans, reviews — the "brain" |
| **Executor backend** | the code editor (`codex`, `claude-code`, `stub`) | does the actual edits — the "hands" |
| **Sandbox (git worktree)** | executor edits land in an isolated worktree | nothing touches your real code until you accept |
| **Verifier** | gproj runs git + your test command itself | the source of truth for "did it pass" — not the executor |
| **State machine** | `init → planning → packaged → executing → reviewing → deciding` | one phase at a time, human gate enforced |

The non-negotiable rule that ties it together: **the executor proposes, gproj
verifies, and you decide.** The model never gets to mark its own work as done,
and your real codebase never changes without your explicit `accept`.

---

## Getting started

```bash
npm i -g gproj            # (once published) — or `npm link` from a clone

cd your-project           # a git repo
gproj init "Your goal in one sentence"

# Optional: configure how it verifies, in .gproj/config.json
#   { "testCommand": ["npm","test"], "plannerBackend": "oracle-browser",
#     "executorBackend": "codex", "sandbox": { "mode": "worktree" } }

gproj advance             # plan → edit (sandboxed) → review
gproj status              # see the phase + next step
gproj decide accept       # approve; your real code updates atomically
```

That's the whole thing: set direction, let the brain plan and the hands edit on
a scratch copy, let gproj prove it works, and you make the call.
