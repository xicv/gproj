import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { runRecover } from "../../src/commands/recover.js";
import { appendJournal, readJournal } from "../../src/format/journal.js";
import { writeState } from "../../src/format/store.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gproj-"));
  writeState(root, { currentPhase: 1, status: "reviewing", phases: [] });
});

describe("recover", () => {
  it("reports no interruption when the last operation completed", async () => {
    appendJournal(root, { phase: 1, event: "exec_start", status: "packaged" });
    appendJournal(root, { phase: 1, event: "exec_done", status: "reviewing", runId: "p1-r1" });

    const result = await runRecover(root);

    expect(result.interrupted).toBe(false);
    expect(result.recommendation).not.toContain("gproj exec");
  });

  it("records an abort and recommends retrying interrupted exec", async () => {
    appendJournal(root, { phase: 1, event: "exec_start", status: "packaged" });

    const result = await runRecover(root);
    const events = readJournal(root);

    expect(result.interrupted).toBe(true);
    expect(events.some((entry) => entry.event === "abort" && entry.detail === "exec")).toBe(true);
    expect(result.recommendation).toContain("gproj exec");
    expect(result.recommendation).toContain("partial edits");
  });

  it("clears a dead-pid lock before acquiring the recover lock", async () => {
    mkdirSync(join(root, ".gproj"), { recursive: true });
    writeFileSync(join(root, ".gproj", ".lock"), JSON.stringify({
      pid: 999999,
      label: "exec",
      ts: Date.now(),
      token: "dead",
    }));

    const result = await runRecover(root);

    expect(existsSync(join(root, ".gproj", ".lock"))).toBe(false);
    expect(result.actions).toContain("cleared stale lock");
  });
});
