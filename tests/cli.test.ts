import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.js";
import { runInit } from "../src/commands/init.js";
import { runPackage } from "../src/commands/package.js";
import { filePath } from "../src/format/paths.js";
import { writeMarkdown } from "../src/format/store.js";

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
    expect(errors.join("\n")).toContain("sync");
    expect(errors.join("\n")).toContain("catalog");
    expect(errors.join("\n")).toContain("install-agent");
  });

  it("uses configured planner backend unless env overrides it", async () => {
    runInit(root, "Build X");
    mkdirSync(join(root, ".gproj"), { recursive: true });
    writeFileSync(join(root, ".gproj", "config.json"), JSON.stringify({ plannerBackend: "missing-planner" }));

    await expect(runCli(root, ["package"], { log: () => undefined, error: () => undefined }, {})).rejects.toThrow(
      "unknown planner backend: missing-planner",
    );

    const lines: string[] = [];
    await runCli(root, ["package"], { log: (line) => lines.push(line), error: () => undefined }, { GPROJ_PLANNER: "stub" });
    expect(lines.join("\n")).toContain("status packaged");
  });

  it("uses configured maxPackTokens unless env overrides it", async () => {
    runInit(root, "Build X");
    mkdirSync(join(root, ".gproj"), { recursive: true });
    writeFileSync(join(root, ".gproj", "config.json"), JSON.stringify({ maxPackTokens: 20 }));
    writeMarkdown(root, "phases/01/plan.md", "# Phase\n" + "mandatory ".repeat(500));

    await expect(runCli(root, ["package"], { log: () => undefined, error: () => undefined }, {})).rejects.toThrow(
      "maxPackTokens=20",
    );

    const lines: string[] = [];
    await runCli(root, ["package"], { log: (line) => lines.push(line), error: () => undefined }, { GPROJ_MAX_TOKENS: "4000", GPROJ_PLANNER: "stub" });
    expect(lines.join("\n")).toContain("status packaged");
  });

  it("prints an explicit unverified banner after exec with no checks configured", async () => {
    runInit(root, "Build X");
    writeFileSync(filePath(root, "config.json"), JSON.stringify({ sandbox: { mode: "none" } }));
    await runPackage(root, { plannerName: "stub", maxTokens: 4000 });

    const lines: string[] = [];
    await runCli(root, ["exec"], { log: (line) => lines.push(line), error: () => undefined }, { GPROJ_EXECUTOR: "stub" });

    expect(lines.join("\n")).toContain("UNVERIFIED RUN (no test/typecheck configured)");
  });
});
