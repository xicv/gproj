import { existsSync } from "node:fs";
import { filePath } from "../format/paths.js";
import { writeState, writeMarkdown } from "../format/store.js";

export function runInit(root: string, goal: string): void {
  if (existsSync(filePath(root, "state.json"))) throw new Error("gproj already initialized in this directory");
  writeMarkdown(root, "project.md", `# Goal\n\n${goal}\n\n## Constraints\n\n(define)\n\n## Acceptance\n\n(define)\n`);
  writeMarkdown(root, "acceptance.md", "# Acceptance checklist\n\n- [ ] (define)\n");
  writeState(root, { currentPhase: 1, status: "init", phases: [], activeWorktree: null, packageId: 0 });
}
