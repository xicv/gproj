import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.js";
import { runPackage } from "../../src/commands/package.js";
import { runExec } from "../../src/commands/exec.js";
import { runReview } from "../../src/commands/review.js";
import { runDecide } from "../../src/commands/decide.js";
import { readState } from "../../src/format/store.js";
import { readJournal } from "../../src/format/journal.js";
import { existsSync } from "node:fs";
import { filePath, runPath } from "../../src/format/paths.js";
import { registerExecutorTarget } from "../../src/backends/executor.js";

let root: string;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "gproj-"));
  runInit(root, "Build X");
  writeFileSync(filePath(root, "config.json"), JSON.stringify({ sandbox: { mode: "none" } }));
  await runPackage(root, { plannerName: "stub", maxTokens: 4000 });
});

function git(args: string[], cwd: string) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.status };
}

function initGitRepo(root: string): void {
  expect(git(["init"], root).code).toBe(0);
  expect(git(["config", "user.email", "test@example.com"], root).code).toBe(0);
  expect(git(["config", "user.name", "Test User"], root).code).toBe(0);
  writeFileSync(join(root, "README.md"), "base\n");
  expect(git(["add", "README.md"], root).code).toBe(0);
  expect(git(["commit", "-m", "init"], root).code).toBe(0);
}

describe("exec", () => {
  it("runs the executor and writes a valid run evidence record", async () => {
    const runId = await runExec(root, { executorName: "stub" });
    expect(existsSync(runPath(root, runId))).toBe(true);
    expect(readState(root)?.status).toBe("reviewing");
  });

  it("records the current package id on the run evidence", async () => {
    await runPackage(root, { plannerName: "stub", maxTokens: 4000 });

    const runId = await runExec(root, { executorName: "stub" });
    const run = JSON.parse(readFileSync(runPath(root, runId), "utf8"));

    expect(run.packageId).toBe(2);
  });

  it("persists failing verifier evidence even when the executor claims tests passed", async () => {
    writeFileSync(filePath(root, "config.json"), JSON.stringify({ sandbox: { mode: "none" }, testCommand: ["node", "-e", "process.exit(1)"] }));

    const runId = await runExec(root, { executorName: "stub" });
    const run = JSON.parse(readFileSync(runPath(root, runId), "utf8"));

    expect(run.testsPassed).toBe(false);
    expect(run.verifierPassed).toBe(false);
    expect(run.verifierFailures.length).toBeGreaterThan(0);
    expect(run.executorClaims.testsPassed).toBe(true);
  });

  it("persists passing verifier evidence", async () => {
    writeFileSync(filePath(root, "config.json"), JSON.stringify({ sandbox: { mode: "none" }, testCommand: ["node", "-e", ""] }));

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

  it("journals exec start and done with the run id", async () => {
    const runId = await runExec(root, { executorName: "stub" });
    const execEvents = readJournal(root).filter((entry) => entry.event.startsWith("exec_"));

    expect(execEvents.map((entry) => entry.event)).toEqual(["exec_start", "exec_done"]);
    expect(execEvents[1]?.runId).toBe(runId);
  });

  it("runs the executor and verifier in a sandbox worktree", async () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), "gproj-"));
    initGitRepo(sandboxRoot);
    runInit(sandboxRoot, "Build X");
    writeFileSync(filePath(sandboxRoot, "config.json"), JSON.stringify({
      sandbox: { mode: "worktree" },
      testCommand: ["node", "-e", "process.exit(require('node:fs').existsSync('sandbox-output.txt') ? 0 : 1)"],
    }));
    await runPackage(sandboxRoot, { plannerName: "stub", maxTokens: 4000 });
    registerExecutorTarget({
      name: "stub-write",
      async run(req) {
        writeFileSync(join(req.root, "sandbox-output.txt"), "sandboxed\n");
        return { changedFiles: ["sandbox-output.txt"], diffStat: "+1 -0", testsPassed: true, failures: [], raw: "wrote file" };
      },
    });

    const runId = await runExec(sandboxRoot, { executorName: "stub-write" });
    const state = readState(sandboxRoot);
    const run = JSON.parse(readFileSync(runPath(sandboxRoot, runId), "utf8"));

    expect(existsSync(join(sandboxRoot, "sandbox-output.txt"))).toBe(false);
    expect(state?.activeWorktree).toEqual(expect.any(String));
    expect(existsSync(join(state?.activeWorktree ?? "", "sandbox-output.txt"))).toBe(true);
    expect(run.changedFiles).toEqual(["sandbox-output.txt"]);
    expect(run.verifierPassed).toBe(true);
  });

  it("embeds the phase plan into the executor prompt so it is self-contained", async () => {
    // The executor runs in a worktree without .gproj/, so the plan must travel
    // inside the prompt — not be referenced. Overwrite the plan with a marker
    // and assert the executor actually receives it alongside the exec-prompt.
    writeFileSync(filePath(root, "phases/01.md"), "PLAN-MARKER: implement the widget exactly so\n");
    let captured = "";
    registerExecutorTarget({
      name: "stub-capture",
      async run(req) {
        captured = req.prompt;
        return { changedFiles: [], diffStat: "", testsPassed: false, failures: [], raw: "" };
      },
    });

    await runExec(root, { executorName: "stub-capture" });

    expect(captured).toContain("PLAN-MARKER: implement the widget exactly so");
    expect(captured).toContain("Executor instruction");
  });
});
