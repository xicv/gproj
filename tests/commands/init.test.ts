import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.js";
import { readState, readMarkdown } from "../../src/format/store.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

describe("init", () => {
  it("scaffolds project.md and state.json", () => {
    runInit(root, "Build a coding agent");
    expect(readMarkdown(root, "project.md")).toContain("Build a coding agent");
    expect(readState(root)?.currentPhase).toBe(1);
    expect(readState(root)?.status).toBe("init");
  });
  it("is idempotent-safe: refuses to clobber existing project", () => {
    runInit(root, "first");
    expect(() => runInit(root, "second")).toThrow(/already initialized/i);
  });
});
