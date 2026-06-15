# gproj

A cross-tool persistent planner brain. Human sets direction; a high-reasoning planner clarifies/plans/reviews; an executor (Codex or Claude Code) edits code. State lives on disk in `.gproj/` and is assembled into a bounded context pack each round.

## Install
`npm i -g gproj` (or `npm link` from a clone).

## Use
```
gproj init "Build a meeting agent"
GPROJ_PLANNER=oracle-browser GPROJ_EXECUTOR=codex gproj advance
gproj status
gproj decide accept
```

## Backends
- Planner: `stub` | `oracle-browser` | `openai-responses`
- Executor: `stub` | `codex` | `claude-code`
