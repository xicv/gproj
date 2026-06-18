import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.js";
import { runRetarget } from "../../src/commands/retarget.js";
import { readJournal } from "../../src/format/journal.js";
import { readMarkdown, readState } from "../../src/format/store.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gproj-"));
  runInit(root, "Build X");
});

describe("retarget", () => {
  it("sets GOAL, advances currentPhase, and returns to planning", () => {
    runRetarget(root, "Build Y");

    expect(readMarkdown(root, "GOAL.md")).toBe("# Goal\n\nBuild Y\n\n## Constraints\n\n(define)\n\n## Acceptance\n\n(define)\n");
    expect(readState(root)).toMatchObject({
      currentPhase: 2,
      status: "planning",
      phases: [{ id: 2, title: "phase 2", status: "pending" }],
    });
    expect(readJournal(root).at(-1)).toMatchObject({ phase: 2, event: "retarget", status: "planning" });
  });
});
