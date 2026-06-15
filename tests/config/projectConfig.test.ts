import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config/projectConfig.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

describe("project config", () => {
  it("returns defaults when the config file is absent", () => {
    expect(loadConfig(root)).toEqual({
      testCommand: undefined,
      typecheckCommand: undefined,
      plannerBackend: "stub",
      executorBackend: "stub",
      plannerModel: undefined,
      maxPackTokens: 6000,
      sandbox: { mode: "worktree" },
      redactions: [],
    });
  });

  it("reads and merges a partial config", () => {
    mkdirSync(join(root, ".gproj"), { recursive: true });
    writeFileSync(join(root, ".gproj", "config.json"), JSON.stringify({
      testCommand: ["npm", "test"],
      plannerBackend: "openai",
      maxPackTokens: 3000,
      sandbox: { mode: "none" },
      redactions: ["SECRET"],
    }));

    expect(loadConfig(root)).toEqual({
      testCommand: ["npm", "test"],
      typecheckCommand: undefined,
      plannerBackend: "openai",
      executorBackend: "stub",
      plannerModel: undefined,
      maxPackTokens: 3000,
      sandbox: { mode: "none" },
      redactions: ["SECRET"],
    });
  });

  it("rejects an invalid sandbox mode", () => {
    mkdirSync(join(root, ".gproj"), { recursive: true });
    writeFileSync(join(root, ".gproj", "config.json"), JSON.stringify({
      sandbox: { mode: "unsafe" },
    }));

    expect(() => loadConfig(root)).toThrow();
  });

  it("reports malformed JSON with the config path", () => {
    mkdirSync(join(root, ".gproj"), { recursive: true });
    writeFileSync(join(root, ".gproj", "config.json"), "{");

    expect(() => loadConfig(root)).toThrow(/invalid \.gproj\/config\.json/);
  });
});
