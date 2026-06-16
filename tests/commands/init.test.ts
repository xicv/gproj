import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.js";
import { readState, readMarkdown } from "../../src/format/store.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

describe("init", () => {
  it("scaffolds GOAL.md, STATUS.md, and state.json", () => {
    runInit(root, "Build a coding agent");
    expect(readMarkdown(root, "GOAL.md")).toContain("Build a coding agent");
    expect(readMarkdown(root, "STATUS.md")).toContain("Current phase: 1");
    expect(readState(root)?.currentPhase).toBe(1);
    expect(readState(root)?.status).toBe("init");
  });
  it("is idempotent-safe: refuses to clobber existing project", () => {
    runInit(root, "first");
    expect(() => runInit(root, "second")).toThrow(/already initialized/i);
  });
  it("does NOT create a .gitignore when none exists", () => {
    runInit(root, "goal");
    expect(existsSync(join(root, ".gitignore"))).toBe(false);
  });
  it("appends .gproj/ to an existing .gitignore", () => {
    writeFileSync(join(root, ".gitignore"), "node_modules\n");
    runInit(root, "goal");
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toMatch(/^\.gproj\/$/m);
  });
  it("does not duplicate .gproj/ when already ignored", () => {
    writeFileSync(join(root, ".gitignore"), ".gproj/\nnode_modules\n");
    runInit(root, "goal");
    const gi = readFileSync(join(root, ".gitignore"), "utf8");
    expect((gi.match(/\.gproj/g) || []).length).toBe(1);
  });
});
