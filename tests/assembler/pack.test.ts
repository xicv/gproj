import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMarkdown, appendNdjson, writeState } from "../../src/format/store.js";
import { buildContextPack } from "../../src/assembler/pack.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gproj-"));
  writeState(root, { currentPhase: 1, status: "planning", phases: [] });
  writeMarkdown(root, "project.md", "# Goal\nBuild X");
  writeMarkdown(root, "architecture.md", "# Arch\nCLI + store");
  appendNdjson(root, "decisions.ndjson", { ts: "t", title: "local-first", why: "no project API" });
});

describe("buildContextPack", () => {
  it("includes goal, arch, and decisions", () => {
    const pack = buildContextPack(root, 1, 4000);
    expect(pack).toContain("Build X");
    expect(pack).toContain("CLI + store");
    expect(pack).toContain("local-first");
  });
  it("respects the token budget by dropping low-priority sections", () => {
    appendNdjson(root, "known-issues.ndjson", { ts: "t", issue: "z".repeat(8000), severity: "low" });
    const pack = buildContextPack(root, 1, 200);
    expect(pack).toContain("Build X");          // goal is highest priority, kept
    expect(pack).not.toContain("zzzz");          // huge low-priority issue dropped
  });
  it("includes executor run evidence for the phase", () => {
    mkdirSync(join(root, ".gproj", "runs"), { recursive: true });
    writeFileSync(join(root, ".gproj", "runs", "p1-r1.json"), JSON.stringify({
      id: "p1-r1",
      phase: 1,
      promptHash: "hash",
      changedFiles: ["src/example.ts"],
      diffStat: "1 file changed",
      testsPassed: false,
      failures: ["boom"],
    }));

    const pack = buildContextPack(root, 1, 4000);
    expect(pack).toContain("RUN EVIDENCE");
    expect(pack).toContain("boom");
  });
});
