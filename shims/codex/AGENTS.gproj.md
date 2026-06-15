# gproj (Codex)

This repo uses gproj for planner-brain state. Drive it with the CLI:
`gproj init "<goal>"` · `gproj advance` · `gproj status` · `gproj decide accept|adjust|reject`.
Set `GPROJ_EXECUTOR=codex`. Do not expand scope beyond the current phase's exec prompt in `.gproj/packages/`.
