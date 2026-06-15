import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readState, writeState, appendNdjson, readNdjson, writeMarkdown, readMarkdown } from "../../src/format/store.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

describe("store", () => {
  it("round-trips state", () => {
    writeState(root, { currentPhase: 1, status: "init", phases: [] });
    expect(readState(root)?.status).toBe("init");
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
});
