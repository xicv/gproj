import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendJournal, readJournal } from "../../src/format/journal.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

describe("journal", () => {
  it("appends and reads entries in order", () => {
    appendJournal(root, { phase: 1, event: "package_start", status: "planning" });
    appendJournal(root, { phase: 1, event: "package_done", status: "packaged" });

    const entries = readJournal(root);
    expect(entries.map((entry) => entry.event)).toEqual(["package_start", "package_done"]);
    expect(entries.every((entry) => typeof entry.ts === "string" && entry.ts.length > 0)).toBe(true);
  });

  it("returns an empty list when the journal does not exist", () => {
    expect(readJournal(root)).toEqual([]);
  });
});
