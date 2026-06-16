import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.js";
import { runPackage } from "../../src/commands/package.js";
import { runExec } from "../../src/commands/exec.js";
import { runReview } from "../../src/commands/review.js";
import { runDecide } from "../../src/commands/decide.js";
import { readNdjson, readState } from "../../src/format/store.js";
import { readJournal } from "../../src/format/journal.js";
import { filePath, phaseDecisionPath } from "../../src/format/paths.js";
import { registerExecutorTarget } from "../../src/backends/executor.js";

let root: string;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "gproj-"));
  runInit(root, "Build X");
  writeFileSync(filePath(root, "config.json"), JSON.stringify({ sandbox: { mode: "none" } }));
  await runPackage(root, { plannerName: "stub", maxTokens: 4000 });
  await runExec(root, { executorName: "stub" });
});

function git(args: string[], cwd: string) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.status };
}

function initGitRepo(repoRoot: string): void {
  expect(git(["init"], repoRoot).code).toBe(0);
  expect(git(["config", "user.email", "test@example.com"], repoRoot).code).toBe(0);
  expect(git(["config", "user.name", "Test User"], repoRoot).code).toBe(0);
  writeFileSync(join(repoRoot, "README.md"), "base\n");
  expect(git(["add", "README.md"], repoRoot).code).toBe(0);
  expect(git(["commit", "-m", "init"], repoRoot).code).toBe(0);
}

async function runSandboxedReview(filename: string): Promise<{ repoRoot: string; worktreePath: string }> {
  const repoRoot = mkdtempSync(join(tmpdir(), "gproj-"));
  initGitRepo(repoRoot);
  runInit(repoRoot, "Build X");
  writeFileSync(filePath(repoRoot, "config.json"), JSON.stringify({ sandbox: { mode: "worktree" } }));
  await runPackage(repoRoot, { plannerName: "stub", maxTokens: 4000 });
  registerExecutorTarget({
    name: `stub-write-${filename}`,
    async run(req) {
      writeFileSync(join(req.root, filename), "sandboxed\n");
      return { changedFiles: [filename], diffStat: "+1 -0", testsPassed: true, failures: [], raw: "wrote file" };
    },
  });
  await runExec(repoRoot, { executorName: `stub-write-${filename}` });
  const worktreePath = readState(repoRoot)?.activeWorktree;
  expect(worktreePath).toEqual(expect.any(String));
  await runReview(repoRoot, { plannerName: "stub", maxTokens: 4000 });
  return { repoRoot, worktreePath: worktreePath ?? "" };
}

describe("review + decide", () => {
  it("review writes a verdict and sets status deciding", async () => {
    await runReview(root, { plannerName: "stub", maxTokens: 4000 });
    expect(readState(root)?.status).toBe("deciding");
  });
  it("review journals start and done", async () => {
    await runReview(root, { plannerName: "stub", maxTokens: 4000 });
    const reviewEvents = readJournal(root).filter((entry) => entry.event.startsWith("review_"));
    expect(reviewEvents.map((entry) => entry.event)).toEqual(["review_start", "review_done"]);
  });
  it("review throws when there is no completed execution to review", async () => {
    const freshRoot = mkdtempSync(join(tmpdir(), "gproj-"));
    runInit(freshRoot, "Build X");
    await expect(runReview(freshRoot, { plannerName: "stub", maxTokens: 4000 })).rejects.toThrow(
      "nothing to review; run `gproj exec` first (status: init)",
    );
  });
  it("accept advances to the next phase", async () => {
    await runReview(root, { plannerName: "stub", maxTokens: 4000 });
    runDecide(root, "accept");
    expect(readState(root)?.currentPhase).toBe(2);
    expect(readState(root)?.status).toBe("planning");
  });
  it("records the human decision", async () => {
    await runReview(root, { plannerName: "stub", maxTokens: 4000 });
    runDecide(root, "accept");
    expect(readNdjson(root, "decisions.ndjson").some((d) => {
      return typeof d === "object" && d !== null && "title" in d && String(d.title).includes("decision: accept");
    })).toBe(true);
    expect(readFileSync(phaseDecisionPath(root, 1), "utf8")).toContain("accept");
  });
  it("journals the human decision", async () => {
    await runReview(root, { plannerName: "stub", maxTokens: 4000 });
    runDecide(root, "adjust");
    const decision = readJournal(root).findLast((entry) => entry.event === "decide");
    expect(decision?.detail).toBe("adjust");
  });
  it("reject returns to planning on the same phase", async () => {
    await runReview(root, { plannerName: "stub", maxTokens: 4000 });
    runDecide(root, "reject");
    expect(readState(root)?.currentPhase).toBe(1);
    expect(readState(root)?.status).toBe("planning");
  });
  it("rejects an unknown decision", async () => {
    await runReview(root, { plannerName: "stub", maxTokens: 4000 });
    expect(() => runDecide(root, "maybe" as never)).toThrow(/accept\|adjust\|reject/);
  });
  it("decide throws when there is no review decision pending", () => {
    const freshRoot = mkdtempSync(join(tmpdir(), "gproj-"));
    runInit(freshRoot, "Build X");
    expect(() => runDecide(freshRoot, "accept")).toThrow(
      "nothing to decide; run `gproj review` first (status: init)",
    );
  });

  it("accept applies sandbox changes and removes the worktree", async () => {
    const { repoRoot, worktreePath } = await runSandboxedReview("accepted-output.txt");

    runDecide(repoRoot, "accept");

    expect(readFileSync(join(repoRoot, "accepted-output.txt"), "utf8")).toBe("sandboxed\n");
    expect(existsSync(worktreePath)).toBe(false);
    expect(readState(repoRoot)?.activeWorktree).toBe(null);
  });

  it("refuses accept when root HEAD moved after sandbox exec", async () => {
    const { repoRoot, worktreePath } = await runSandboxedReview("stale-output.txt");
    writeFileSync(join(repoRoot, "root-advanced.txt"), "root changed\n");
    expect(git(["add", "root-advanced.txt"], repoRoot).code).toBe(0);
    expect(git(["commit", "-m", "root advanced"], repoRoot).code).toBe(0);

    expect(() => runDecide(repoRoot, "accept")).toThrow(/HEAD moved/);

    const state = readState(repoRoot);
    expect(state?.status).toBe("deciding");
    expect(state?.activeWorktree).toBe(worktreePath);
    expect(existsSync(worktreePath)).toBe(true);
  });

  it("reject discards sandbox changes and removes the worktree", async () => {
    const { repoRoot, worktreePath } = await runSandboxedReview("rejected-output.txt");

    runDecide(repoRoot, "reject");

    expect(existsSync(join(repoRoot, "rejected-output.txt"))).toBe(false);
    expect(existsSync(worktreePath)).toBe(false);
    expect(readState(repoRoot)?.activeWorktree).toBe(null);
  });

  // issue #1: reject/adjust must not require a (costly) review first.
  it("reject works straight from reviewing without a review", () => {
    expect(readState(root)?.status).toBe("reviewing");
    runDecide(root, "reject");
    expect(readState(root)?.status).toBe("planning");
    expect(readState(root)?.currentPhase).toBe(1);
  });

  it("adjust works straight from reviewing without a review", () => {
    expect(readState(root)?.status).toBe("reviewing");
    runDecide(root, "adjust");
    expect(readState(root)?.status).toBe("planning");
  });

  it("accept still requires a review (not allowed from reviewing)", () => {
    expect(readState(root)?.status).toBe("reviewing");
    expect(() => runDecide(root, "accept")).toThrow(/run `gproj review` first/);
  });
});
