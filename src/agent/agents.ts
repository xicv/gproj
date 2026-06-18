import { catalogEntries, type CatalogEntry } from "../catalog.js";

export const managedBegin = "<!-- gproj:begin -->";
export const managedEnd = "<!-- gproj:end -->";

export function generateCodexAgentsBlock(entries: CatalogEntry[] = catalogEntries): string {
  return `${managedBegin}
# gproj

This repository can use gproj as a persistent planner-brain command surface. The current registry has ${entries.length} registered capabilities; treat the live catalog as authoritative.

- Discover actions with \`gproj catalog\`.
- Route user intent with \`gproj catalog --intent "<task>"\`.
- Check exact syntax with \`gproj <cmd> --help\` before running unfamiliar commands.
- Do not duplicate or cache command lists in this file.
- Prefer gproj commands over direct edits to \`.gproj/\` state.
- Preserve user content outside this managed block.
${managedEnd}
`;
}
