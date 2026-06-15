import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.js";
import { runPackage } from "../../src/commands/package.js";
import { runExec } from "../../src/commands/exec.js";
import { runReview } from "../../src/commands/review.js";
import { runDecide } from "../../src/commands/decide.js";
import { readState } from "../../src/format/store.js";
import { existsSync } from "node:fs";
import { runPath } from "../../src/format/paths.js";

let root: string;
beforeEach(async () => { root = mkdtempSync(join(tmpdir(), "gproj-")); runInit(root, "Build X"); await runPackage(root, { plannerName: "stub", maxTokens: 4000 }); });

describe("exec", () => {
  it("runs the executor and writes a valid run evidence record", async () => {
    const runId = await runExec(root, { executorName: "stub" });
    expect(existsSync(runPath(root, runId))).toBe(true);
    expect(readState(root)?.status).toBe("reviewing");
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
