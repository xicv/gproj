import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWrite, readState, writeState, appendNdjson, readNdjson, writeMarkdown, readMarkdown } from "../../src/format/store.js";
import { filePath, phaseDecisionPath, phaseExecPromptPath, phasePlanPath, phaseReviewPath, phaseRunPath, statusPath } from "../../src/format/paths.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

describe("store", () => {
  it("round-trips state", () => {
    writeState(root, { currentPhase: 1, status: "init", phases: [] });
    expect(readState(root)?.status).toBe("init");
  });
  it("generates a human status view from state and latest run verdict", () => {
    writeState(root, {
      currentPhase: 1,
      status: "reviewing",
      phases: [{ id: 1, title: "phase 1", status: "planned" }],
    });
    mkdirSync(join(root, ".gproj", "phases", "01"), { recursive: true });
    writeFileSync(phaseRunPath(root, 1, 1), JSON.stringify({
      id: "p1-r1",
      phase: 1,
      promptHash: "hash",
      changedFiles: [],
      diffStat: "",
      testsPassed: true,
      failures: [],
      verifierPassed: true,
      verifierFailures: [],
    }));
    writeState(root, {
      currentPhase: 1,
      status: "reviewing",
      phases: [{ id: 1, title: "phase 1", status: "planned" }],
    });

    const status = readFileSync(statusPath(root), "utf8");
    expect(status).toContain("Current phase: 1");
    expect(status).toContain("Status: reviewing");
    expect(status).toContain("Latest run: PASS");
    expect(status).toContain("▶ Phase 01");
  });
  it("appends and reads ndjson decisions", () => {
    appendNdjson(root, "decisions.ndjson", { ts: "t", title: "x", why: "y" });
    appendNdjson(root, "decisions.ndjson", { ts: "t2", title: "z", why: "w" });
    expect(readNdjson(root, "decisions.ndjson").length).toBe(2);
  });
  it("round-trips markdown", () => {
    writeMarkdown(root, "prd.md", "# PRD\nhello");
    expect(readMarkdown(root, "prd.md")).toContain("hello");
  });
  it("returns null state when absent", () => {
    expect(readState(root)).toBeNull();
  });
  it("migrates an old layout lazily when reading state", () => {
    mkdirSync(join(root, ".gproj", "phases"), { recursive: true });
    mkdirSync(join(root, ".gproj", "packages"), { recursive: true });
    mkdirSync(join(root, ".gproj", "runs"), { recursive: true });
    mkdirSync(join(root, ".gproj", "reviews"), { recursive: true });
    writeFileSync(filePath(root, "state.json"), JSON.stringify({ currentPhase: 1, status: "reviewing", phases: [] }));
    writeFileSync(filePath(root, "project.md"), "# Goal\nold");
    writeFileSync(filePath(root, "journal.ndjson"), JSON.stringify({ ts: "t", phase: 1, event: "exec_done" }) + "\n");
    writeFileSync(filePath(root, "phases/01.md"), "old plan");
    writeFileSync(filePath(root, "phases/p1-pkg2.md"), "newest plan");
    writeFileSync(filePath(root, "packages/01-exec-prompt.md"), "old prompt");
    writeFileSync(filePath(root, "packages/p1-pkg2-exec-prompt.md"), "newest prompt");
    writeFileSync(filePath(root, "runs/p1-r3.json"), JSON.stringify({
      id: "p1-r3",
      phase: 1,
      promptHash: "hash",
      changedFiles: [],
      diffStat: "",
      testsPassed: false,
      failures: [],
      verifierPassed: false,
      verifierFailures: [],
    }));
    writeFileSync(filePath(root, "reviews/p1-v2.md"), "review");

    expect(readState(root)?.status).toBe("reviewing");

    expect(readMarkdown(root, "GOAL.md")).toContain("old");
    expect(readMarkdown(root, "history.ndjson")).toContain("exec_done");
    expect(readFileSync(phasePlanPath(root, 1), "utf8")).toBe("newest plan");
    expect(readFileSync(phaseExecPromptPath(root, 1), "utf8")).toBe("newest prompt");
    expect(existsSync(phaseRunPath(root, 1, 3))).toBe(true);
    expect(readFileSync(phaseReviewPath(root, 1, 2), "utf8")).toBe("review");
    expect(existsSync(filePath(root, "project.md"))).toBe(false);
    expect(existsSync(filePath(root, "journal.ndjson"))).toBe(false);
    expect(existsSync(filePath(root, "packages"))).toBe(false);
    expect(existsSync(phaseDecisionPath(root, 1))).toBe(false);
  });
  it("atomicWrite leaves no temp files behind after success", () => {
    const p = join(root, "state.json");
    atomicWrite(p, "ok");
    expect(readdirSync(root).filter((name) => name.startsWith("state.json.tmp-"))).toEqual([]);
  });
  it("atomicWrite fully replaces existing content", () => {
    const p = join(root, "state.json");
    atomicWrite(p, "longer content");
    atomicWrite(p, "short");
    expect(readFileSync(p, "utf8")).toBe("short");
  });
});
