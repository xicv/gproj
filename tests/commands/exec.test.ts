import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.js";
import { runPackage } from "../../src/commands/package.js";
import { runExec } from "../../src/commands/exec.js";
import { runReview } from "../../src/commands/review.js";
import { runDecide } from "../../src/commands/decide.js";
import { readState } from "../../src/format/store.js";
import { existsSync } from "node:fs";
import { filePath, runPath } from "../../src/format/paths.js";

let root: string;
beforeEach(async () => { root = mkdtempSync(join(tmpdir(), "gproj-")); runInit(root, "Build X"); await runPackage(root, { plannerName: "stub", maxTokens: 4000 }); });

describe("exec", () => {
  it("runs the executor and writes a valid run evidence record", async () => {
    const runId = await runExec(root, { executorName: "stub" });
    expect(existsSync(runPath(root, runId))).toBe(true);
    expect(readState(root)?.status).toBe("reviewing");
  });

  it("persists failing verifier evidence even when the executor claims tests passed", async () => {
    writeFileSync(filePath(root, "config.json"), JSON.stringify({ testCommand: ["node", "-e", "process.exit(1)"] }));

    const runId = await runExec(root, { executorName: "stub" });
    const run = JSON.parse(readFileSync(runPath(root, runId), "utf8"));

    expect(run.testsPassed).toBe(false);
    expect(run.verifierPassed).toBe(false);
    expect(run.verifierFailures.length).toBeGreaterThan(0);
    expect(run.executorClaims.testsPassed).toBe(true);
  });

  it("persists passing verifier evidence", async () => {
    writeFileSync(filePath(root, "config.json"), JSON.stringify({ testCommand: ["node", "-e", ""] }));

    const runId = await runExec(root, { executorName: "stub" });
    const run = JSON.parse(readFileSync(runPath(root, runId), "utf8"));

    expect(run.testsPassed).toBe(true);
    expect(run.verifierPassed).toBe(true);
    expect(run.verifierFailures).toEqual([]);
  });

  it("fails closed as unverified when no verifier config exists", async () => {
    const runId = await runExec(root, { executorName: "stub" });
    const run = JSON.parse(readFileSync(runPath(root, runId), "utf8"));

    expect(run.testsPassed).toBe(false);
    expect(run.verifierPassed).toBe(false);
    expect(run.verifierFailures.join("\n")).toContain("unverified");
  });

  it("throws when there is no packaged phase to execute", async () => {
    const freshRoot = mkdtempSync(join(tmpdir(), "gproj-"));
    runInit(freshRoot, "Build X");
    await expect(runExec(freshRoot, { executorName: "stub" })).rejects.toThrow(
      "no packaged phase to execute; run `gproj package` first (status: init)",
    );
  });

  it("allocates run ids from max existing index instead of count", async () => {
    const first = await runExec(root, { executorName: "stub" });
    await runReview(root, { plannerName: "stub", maxTokens: 4000 });
    runDecide(root, "adjust");
    await runPackage(root, { plannerName: "stub", maxTokens: 4000 });
    const second = await runExec(root, { executorName: "stub" });

    unlinkSync(runPath(root, first));
    await runReview(root, { plannerName: "stub", maxTokens: 4000 });
    runDecide(root, "adjust");
    await runPackage(root, { plannerName: "stub", maxTokens: 4000 });
    const third = await runExec(root, { executorName: "stub" });

    expect(second).toBe("p1-r2");
    expect(third).toBe("p1-r3");
    expect(existsSync(runPath(root, third))).toBe(true);
  });
});
