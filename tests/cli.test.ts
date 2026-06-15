import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.js";
import { runInit } from "../src/commands/init.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

describe("cli", () => {
  it("locks mutating commands", async () => {
    mkdirSync(join(root, ".gproj"), { recursive: true });
    writeFileSync(join(root, ".gproj", ".lock"), JSON.stringify({ pid: process.pid, label: "other", ts: Date.now() }));

    await expect(runCli(root, ["init", "Build X"])).rejects.toThrow(/busy/);
  });

  it("does not lock status", async () => {
    runInit(root, "Build X");
    writeFileSync(join(root, ".gproj", ".lock"), JSON.stringify({ pid: process.pid, label: "other", ts: Date.now() }));

    const lines: string[] = [];
    await runCli(root, ["status"], { log: (line) => lines.push(line), error: () => undefined });
    expect(lines.join("\n")).toContain("status");
  });

  it("does not lock doctor", async () => {
    runInit(root, "Build X");
    writeFileSync(join(root, ".gproj", ".lock"), JSON.stringify({ pid: process.pid, label: "other", ts: Date.now() }));

    const lines: string[] = [];
    await runCli(root, ["doctor"], { log: (line) => lines.push(line), error: () => undefined });
    expect(lines.join("\n")).toContain("status");
  });

  it("runs recover through the command's own lock", async () => {
    runInit(root, "Build X");

    const lines: string[] = [];
    await runCli(root, ["recover"], { log: (line) => lines.push(line), error: () => undefined });
    expect(lines.join("\n")).toContain("interrupted: false");
  });

  it("includes recover and doctor in unknown-command help", async () => {
    const errors: string[] = [];
    await expect(runCli(root, ["bogus"], { log: () => undefined, error: (line) => errors.push(line) })).rejects.toThrow("cli exit");
    expect(errors.join("\n")).toContain("recover");
    expect(errors.join("\n")).toContain("doctor");
  });
});
