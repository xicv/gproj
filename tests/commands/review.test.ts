import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.js";
import { runPackage } from "../../src/commands/package.js";
import { runExec } from "../../src/commands/exec.js";
import { runReview } from "../../src/commands/review.js";
import { filePath, phaseReviewPath } from "../../src/format/paths.js";

describe("review", () => {
  it("passes review-hardening guidance to the planner", async () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-"));
    runInit(root, "Build X");
    writeFileSync(filePath(root, "config.json"), JSON.stringify({ sandbox: { mode: "none" } }));
    await runPackage(root, { plannerName: "stub", maxTokens: 4000 });
    await runExec(root, { executorName: "stub" });

    await runReview(root, { plannerName: "stub", maxTokens: 4000 });

    const review = readFileSync(phaseReviewPath(root, 1, 1), "utf8");
    expect(review).toContain("may be TRUNCATED");
    expect(review).toContain("authoritative that the code EXISTS");
    expect(review).toContain("ASSERT the acceptance behavior");
  });
});
