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
});
