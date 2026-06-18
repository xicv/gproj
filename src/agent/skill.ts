import { catalogEntries, type CatalogEntry } from "../catalog.js";

export function generateClaudeSkillMarkdown(entries: CatalogEntry[] = catalogEntries): string {
  return `---
name: gproj
description: Use when the user wants to run gproj's persistent planner-brain command surface. Resolve actions through the live catalog instead of relying on static command memory.
---
<!-- gproj:begin -->
# gproj

This skill is generated from the gproj command registry (${entries.length} registered capabilities). Treat the registry as the source of truth and do not reimplement gproj logic inline.

## Routing

- Discover current capabilities with \`gproj catalog\`.
- For intent-based routing, run \`gproj catalog --intent "<user task>"\` and choose from the returned entries.
- Before executing an unfamiliar action, inspect syntax with \`gproj <cmd> --help\`.
- Treat catalog output as an opaque interface; do not depend on unlisted schema details.

## Safety

- Keep work scoped to the current gproj goal and phase.
- Prefer gproj commands over direct edits to \`.gproj/\` state.
- Preserve user files and existing agent instructions outside managed gproj blocks.
- Use recorded evidence, diffs, and verification results when advancing or reviewing work.
<!-- gproj:end -->
`;
}
