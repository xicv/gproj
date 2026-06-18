import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.js";
import { runPackage } from "../../src/commands/package.js";
import { readMarkdown, readState, writeMarkdown } from "../../src/format/store.js";
import { readJournal } from "../../src/format/journal.js";
import { filePath } from "../../src/format/paths.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); runInit(root, "Build X"); });

describe("package", () => {
  it("writes a phase plan and an exec prompt using the planner backend", async () => {
    await runPackage(root, { plannerName: "stub", maxTokens: 4000 });
    expect(readMarkdown(root, "phases/01/plan.md")).toContain("STUB PLAN");
    expect(readMarkdown(root, "phases/01/exec-prompt.md")).toBeTruthy();
    expect(readState(root)?.status).toBe("packaged");
  });

  it("populates phase metadata for the current phase", async () => {
    await runPackage(root, { plannerName: "stub", maxTokens: 4000 });
    expect(readState(root)?.phases).toContainEqual(expect.objectContaining({ id: 1, title: "phase 1", status: "planned" }));
    expect(readState(root)?.phases[0].goalHash).toMatch(/^[a-f0-9]{12}$/);
  });

  it("journals package start and done", async () => {
    await runPackage(root, { plannerName: "stub", maxTokens: 4000 });
    expect(readJournal(root).map((entry) => entry.event)).toEqual(["package_start", "package_done"]);
  });

  it("throws PACK_TOO_LARGE before asking the planner when mandatory context overflows", async () => {
    writeMarkdown(root, "GOAL.md", "# Goal\n\n" + "mandatory ".repeat(500));

    await expect(runPackage(root, { plannerName: "stub", maxTokens: 20 })).rejects.toThrow(
      "PACK_TOO_LARGE: mandatory context (goal/phase/run evidence) exceeds maxPackTokens=20; raise maxPackTokens or compact decisions/known-issues",
    );

    expect(readMarkdown(root, "phases/01/exec-prompt.md")).toBeNull();
  });

  it("clears stale current-phase artifacts before packaging and records the goal hash", async () => {
    writeMarkdown(root, "phases/01/plan.md", "# Old plan\n");
    writeMarkdown(root, "phases/01/exec-prompt.md", "# Old exec\n");
    writeMarkdown(root, "phases/01/review-1.md", "# Old review\n");
    writeMarkdown(root, "phases/01/decision.md", "# Old decision\n");
    writeFileSync(filePath(root, "phases/01/run-1.json"), JSON.stringify({
      id: "p1-r1",
      phase: 1,
      promptHash: "old",
      changedFiles: [],
      diffStat: "",
      testsPassed: true,
      failures: [],
    }));

    await runPackage(root, { plannerName: "stub", maxTokens: 4000 });

    expect(readMarkdown(root, "phases/01/plan.md")).toContain("STUB PLAN");
    expect(readMarkdown(root, "phases/01/exec-prompt.md")).toContain("STUB PLAN");
    expect(existsSync(filePath(root, "phases/01/review-1.md"))).toBe(false);
    expect(existsSync(filePath(root, "phases/01/decision.md"))).toBe(false);
    expect(existsSync(filePath(root, "phases/01/run-1.json"))).toBe(false);
    expect(readState(root)?.phases.find((phase) => phase.id === 1)?.goalHash).toMatch(/^[a-f0-9]{12}$/);
  });

  it("updates the canonical latest files without legacy versioned package copies", async () => {
    await runPackage(root, { plannerName: "stub", maxTokens: 4000 });
    const firstPrompt = readMarkdown(root, "phases/01/exec-prompt.md");

    await runPackage(root, { plannerName: "stub", maxTokens: 4000 });
    const secondPrompt = readMarkdown(root, "phases/01/exec-prompt.md");

    expect(readState(root)?.packageId).toBe(2);
    expect(secondPrompt).toBeTruthy();
    expect(readMarkdown(root, "phases/01/exec-prompt.md")).toBe(secondPrompt);
    expect(existsSync(filePath(root, "packages/p1-pkg1-exec-prompt.md"))).toBe(false);
    expect(existsSync(filePath(root, "packages/p1-pkg2-exec-prompt.md"))).toBe(false);
    expect(existsSync(filePath(root, "phases/p1-pkg1.md"))).toBe(false);
    expect(existsSync(filePath(root, "phases/p1-pkg2.md"))).toBe(false);
    expect(firstPrompt).not.toBe(secondPrompt);
  });
});
