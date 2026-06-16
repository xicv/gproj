import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { goalPath, statePath } from "../format/paths.js";
import { writeState, writeMarkdown, writeMarkdownPath } from "../format/store.js";

export function runInit(root: string, goal: string): void {
  if (existsSync(statePath(root))) throw new Error("gproj already initialized in this directory");
  writeMarkdownPath(goalPath(root), `# Goal\n\n${goal}\n\n## Constraints\n\n(define)\n\n## Acceptance\n\n(define)\n`);
  writeMarkdown(root, "acceptance.md", "# Acceptance checklist\n\n- [ ] (define)\n");
  writeState(root, { currentPhase: 1, status: "init", phases: [], activeWorktree: null, packageId: 0 });
  ignoreGprojDir(root);
}

// Keep the planner brain local: add `.gproj/` to the repo's .gitignore. Only
// touches an EXISTING .gitignore (never creates one) and is idempotent — a
// repo that already ignores .gproj is left untouched.
function ignoreGprojDir(root: string): void {
  const gitignore = join(root, ".gitignore");
  if (!existsSync(gitignore)) return;
  const content = readFileSync(gitignore, "utf8");
  const alreadyIgnored = content.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed === ".gproj" || trimmed === ".gproj/";
  });
  if (alreadyIgnored) return;
  const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  appendFileSync(gitignore, `${prefix}.gproj/\n`);
}
