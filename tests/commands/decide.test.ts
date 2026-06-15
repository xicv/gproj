import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.js";
import { runPackage } from "../../src/commands/package.js";
import { runExec } from "../../src/commands/exec.js";
import { runReview } from "../../src/commands/review.js";
import { runDecide } from "../../src/commands/decide.js";
import { readNdjson, readState } from "../../src/format/store.js";
import { readJournal } from "../../src/format/journal.js";

let root: string;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "gproj-"));
  runInit(root, "Build X");
  await runPackage(root, { plannerName: "stub", maxTokens: 4000 });
  await runExec(root, { executorName: "stub" });
});

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
});
