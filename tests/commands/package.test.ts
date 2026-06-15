import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.js";
import { runPackage } from "../../src/commands/package.js";
import { readMarkdown, readState } from "../../src/format/store.js";
import { readJournal } from "../../src/format/journal.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); runInit(root, "Build X"); });

describe("package", () => {
  it("writes a phase plan and an exec prompt using the planner backend", async () => {
    await runPackage(root, { plannerName: "stub", maxTokens: 4000 });
    expect(readMarkdown(root, "phases/01.md")).toContain("STUB PLAN");
    expect(readMarkdown(root, "packages/01-exec-prompt.md")).toBeTruthy();
    expect(readState(root)?.status).toBe("packaged");
  });

  it("populates phase metadata for the current phase", async () => {
    await runPackage(root, { plannerName: "stub", maxTokens: 4000 });
    expect(readState(root)?.phases).toContainEqual({ id: 1, title: "phase 1", status: "planned" });
  });

  it("journals package start and done", async () => {
    await runPackage(root, { plannerName: "stub", maxTokens: 4000 });
    expect(readJournal(root).map((entry) => entry.event)).toEqual(["package_start", "package_done"]);
  });
});
