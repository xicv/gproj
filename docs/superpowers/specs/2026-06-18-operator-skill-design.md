# Design: gproj operator skill — self-describing command surface for agents

**Date:** 2026-06-18
**Status:** Approved (design phase)
**Feature:** `gproj catalog` + `gproj install-agent` + operator skill/AGENTS templates.

## Problem

gproj now has ~20 commands/subverbs (init/status/doctor/recover/package/exec/
review/decide/advance/sync, and resources add/organise/list/show/find/schema/
index/link/rm/doctor/capture...). A human's Claude or Codex agent should be able
to DISCOVER, FIND, and EXECUTE the right gproj command without the user
memorizing them — but a hand-written skill that lists commands ROTS as gproj
grows (the same pain skill-catcher has). The fix: make gproj **self-describing**
and keep the skill a thin, stable pointer.

## Approach (B — self-describing)

1. **`gproj catalog [--json] [--intent <text>]`** — gproj emits its own command
   map from an in-code registry: per command/subverb `{ name, group, summary,
   whenToUse, usage, example }`. Default = readable text grouped by area;
   `--json` = structured (single source of truth for tooling); `--intent <text>`
   = rank/filter entries by keyword overlap (reuse the ranked-find idea) so an
   agent can ask "what do I use for debugging?".
2. **Operator skill (Claude `SKILL.md`)** — thin, triggers on gproj intents.
   Body: "gproj is self-describing — run `gproj status` (where am I),
   `gproj catalog` (all commands), `gproj <cmd> --help` (details); NEVER
   reimplement gproj logic." Plus an intent->command routing guide and safety
   notes (decide = human gate; planner sees evidence only; capture redacts).
   No command list inline — details come from `catalog`/`--help`.
3. **Codex `AGENTS.md` block** — same content in AGENTS.md format, generated from
   the same catalog.
4. **`gproj install-agent [--global|--project] [--claude] [--codex]
   [--uninstall]`** — writes the skill + AGENTS block at the chosen scope:
   - global Claude: `~/.claude/skills/gproj/SKILL.md`
   - project Claude: `<repo>/.claude/skills/gproj/SKILL.md`
   - global Codex: `~/.codex/AGENTS.md` (managed block)
   - project Codex: `<repo>/AGENTS.md` (managed block)
   Idempotent via managed-block markers (`<!-- gproj:begin -->`/`end`), atomic
   writes, `--uninstall` removes only the managed block / gproj skill dir.
   Default scope = global, both agents.
5. **`install-hook` gains `--project|--global`** (default global, unchanged
   behavior) for symmetry.

## Decisions (locked)

| Question | Decision |
|---|---|
| Approach | B — self-describing (`catalog`) + `install-agent`, not a static list |
| Default install scope | global, both Claude + Codex |
| Build path | via the gproj loop (dogfood) |

## Components

| Unit | File | Responsibility |
|---|---|---|
| Command registry + render | `src/catalog.ts` | the `{name,group,summary,whenToUse,usage,example}[]` registry; text + JSON render; `--intent` ranking |
| `catalog` command | `src/commands/catalog.ts` | parse flags, print catalog (read-only, no lock) |
| Skill/AGENTS generators | `src/agent/skill.ts`, `src/agent/agents.ts` | render the operator SKILL.md + AGENTS block from the registry |
| `install-agent` command | `src/commands/installAgent.ts` | resolve scope/agents, write/remove skill + AGENTS managed block, idempotent + atomic |
| CLI wiring | `src/cli.ts` | `case "catalog"`, `case "install-agent"`; usage string |
| Hook scope flag | `src/resources/capture/hook.ts` | `--project|--global` |
| Templates upgraded | `shims/claude-skill/SKILL.md`, `shims/codex/AGENTS.gproj.md` | become the operator skill/AGENTS source (full surface, self-describing) |

## Anti-rot guarantee

A test asserts **every** top-level `cli.ts` command and every `resources`
subverb appears in the catalog registry — so a new command without a catalog
entry fails CI. The skill/AGENTS never list commands themselves; they point at
`catalog`, which is generated from the registry. New commands surface
automatically.

## Security

`install-agent` writes only skill/AGENTS files; no secrets, no command
execution. Managed-block markers ensure it never clobbers user-authored AGENTS
content; `--uninstall` removes only gproj's block / skill dir.

## Error handling

- Per gproj convention: actionable `throw new Error(...)`.
- `install-agent`/`install-hook`: create parent dirs; atomic write; idempotent
  re-install; clear message naming the file(s) touched and the scope.
- `catalog --intent` with no matches → print all, with a note.

## Testing (>=80%, mock-injected)

- registry completeness (every cli command + resources subverb has an entry).
- `catalog --json` shape; `--intent` ranking; text render groups.
- skill/AGENTS generators produce valid frontmatter / managed block from registry.
- `install-agent` global + project, claude + codex, idempotent + uninstall (temp HOME / temp repo); AGENTS managed-block merge does not clobber surrounding content.
- `install-hook --project` writes repo settings; `--global` unchanged.

## Scope / phasing (planner may slice)

- **In v1:** `catalog` (+json+intent), registry + completeness test, operator
  skill + AGENTS generators, `install-agent` (global/project, claude/codex,
  uninstall), `install-hook` scope flag, upgraded shim templates.
- **Out of v1:** MCP server (approach C); auto-refresh of installed skill on
  gproj upgrade; per-command long-form docs beyond `--help`.
