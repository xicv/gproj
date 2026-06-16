import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendNdjson, writeMarkdown, writeMarkdownPath, writeState } from "../../src/format/store.js";
import { buildContextPack } from "../../src/assembler/pack.js";
import { goalPath, phasePlanPath, phaseRunPath } from "../../src/format/paths.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gproj-"));
  writeState(root, { currentPhase: 1, status: "planning", phases: [] });
  writeMarkdownPath(goalPath(root), "# Goal\nBuild X");
  writeMarkdown(root, "architecture.md", "# Arch\nCLI + store");
  appendNdjson(root, "decisions.ndjson", { ts: "t", title: "local-first", why: "no project API" });
});

describe("buildContextPack", () => {
  it("includes goal, arch, and decisions", () => {
    const pack = buildContextPack(root, 1, 4000);
    expect(pack.text).toContain("Build X");
    expect(pack.text).toContain("CLI + store");
    expect(pack.text).toContain("local-first");
  });
  it("respects the token budget by dropping low-priority sections", () => {
    appendNdjson(root, "known-issues.ndjson", { ts: "t", issue: "z".repeat(8000), severity: "low" });
    const pack = buildContextPack(root, 1, 50);
    expect(pack.text).toContain("Build X");          // goal is highest priority, kept
    expect(pack.text).not.toContain("zzzz");          // huge low-priority issue dropped
    expect(pack.dropped.map((section) => section.label)).toContain("KNOWN ISSUES");
  });

  it("reports mandatory overflow when mandatory sections exceed the budget", () => {
    writeMarkdownPath(phasePlanPath(root, 1), "# Phase\n" + "mandatory ".repeat(500));

    const pack = buildContextPack(root, 1, 20);

    expect(pack.mandatoryOverflow).toBe(true);
    expect(pack.text).toContain("## PHASE 1");
    expect(pack.text).toContain("mandatory mandatory");
  });

  it("truncates a large non-mandatory section when partial budget remains", () => {
    writeMarkdown(root, "architecture.md", "# Arch\n" + "architecture detail ".repeat(120));

    const pack = buildContextPack(root, 1, 180);

    expect(pack.mandatoryOverflow).toBe(false);
    expect(pack.text).toContain("## ARCHITECTURE");
    expect(pack.text).toContain("…[truncated]");
    expect(pack.truncated).toEqual([
      expect.objectContaining({ label: "ARCHITECTURE" }),
    ]);
  });

  it("sanitizes section text before rendering", () => {
    writeMarkdownPath(goalPath(root), "# Goal\nUse sk-abcDEF0123456789_xyz safely");

    const pack = buildContextPack(root, 1, 4000);

    expect(pack.text).toContain("[REDACTED]");
    expect(pack.text).not.toContain("sk-abcDEF0123456789_xyz");
  });
  it("renders verified run evidence before untrusted executor claims", () => {
    mkdirSync(join(root, ".gproj", "phases", "01"), { recursive: true });
    writeFileSync(phaseRunPath(root, 1, 1), JSON.stringify({
      id: "p1-r1",
      phase: 1,
      promptHash: "hash",
      changedFiles: ["src/example.ts"],
      diffStat: "1 file changed",
      testsPassed: false,
      failures: ["boom"],
      verifierPassed: false,
      verifierFailures: ["verified boom"],
      executorClaims: {
        changedFiles: ["claimed.ts"],
        testsPassed: true,
        diffStat: "claimed stat",
        failures: [],
      },
    }));

    const pack = buildContextPack(root, 1, 4000);
    expect(pack.text).toContain("RUN EVIDENCE");
    expect(pack.text).toContain("overall verifier: FAIL");
    expect(pack.text).toContain("verified boom");
    expect(pack.text).toContain("UNTRUSTED");
    expect(pack.text).toContain("claimed tests: true");
  });

  it("renders a TRUSTED verifier-checks block and a separate bounded DIFF section", () => {
    mkdirSync(join(root, ".gproj", "phases", "01"), { recursive: true });
    writeFileSync(phaseRunPath(root, 1, 1), JSON.stringify({
      id: "p1-r1",
      phase: 1,
      promptHash: "hash",
      changedFiles: ["src/a.ts", "src/b.ts"],
      diffStat: " src/a.ts | 2 +-\n src/b.ts | 9 +++++++++",
      testsPassed: true,
      failures: [],
      verifierPassed: true,
      verifierFailures: [],
      verifierChecks: [
        { command: "npx tsc --noEmit", passed: true, exitCode: 0 },
        { command: "npx vitest run", passed: true, exitCode: 0 },
      ],
      diff: "diff --git a/src/b.ts b/src/b.ts\n+export const added = 1;\n",
    }));

    const pack = buildContextPack(root, 1, 4000);
    expect(pack.text).toContain("TRUSTED");
    expect(pack.text).toContain("npx vitest run → PASS (exit 0)");
    expect(pack.text).toContain("changed files (2):");
    expect(pack.text).toContain("## DIFF");
    expect(pack.text).toContain("export const added = 1;");
  });

  it("uses the highest numeric run id for the latest run in a phase", () => {
    mkdirSync(join(root, ".gproj", "phases", "01"), { recursive: true });
    writeFileSync(phaseRunPath(root, 1, 1), JSON.stringify({
      id: "p1-r1",
      phase: 1,
      promptHash: "hash",
      changedFiles: ["old.ts"],
      diffStat: "old stat",
      testsPassed: true,
      failures: [],
      verifierPassed: true,
      verifierFailures: [],
    }));
    writeFileSync(phaseRunPath(root, 1, 10), JSON.stringify({
      id: "p1-r10",
      phase: 1,
      promptHash: "hash",
      changedFiles: ["new.ts"],
      diffStat: "new stat",
      testsPassed: false,
      failures: ["new failure"],
      verifierPassed: false,
      verifierFailures: ["new verified failure"],
    }));

    const pack = buildContextPack(root, 1, 4000);
    expect(pack.text).toContain("overall verifier: FAIL");
    expect(pack.text).toContain("new.ts");
    expect(pack.text).not.toContain("old.ts");
  });
});
