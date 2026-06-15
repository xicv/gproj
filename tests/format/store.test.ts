import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWrite, readState, writeState, appendNdjson, readNdjson, writeMarkdown, readMarkdown } from "../../src/format/store.js";

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
  it("atomicWrite leaves no temp files behind after success", () => {
    const p = join(root, "state.json");
    atomicWrite(p, "ok");
    expect(readdirSync(root).filter((name) => name.startsWith("state.json.tmp-"))).toEqual([]);
  });
  it("atomicWrite fully replaces existing content", () => {
    const p = join(root, "state.json");
    atomicWrite(p, "longer content");
    atomicWrite(p, "short");
    expect(readFileSync(p, "utf8")).toBe("short");
  });
});
