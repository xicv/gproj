import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlannerBackend } from "../src/backends/planner.js";
import { runCli } from "../src/cli.js";
import { getAll } from "../src/resources/manifest.js";
import { listPendingCaptures } from "../src/resources/capture/pending.js";
import { hookCommand } from "../src/resources/capture/hook.js";

function transcript(home: string, sessionId: string): void {
  const dir = join(home, ".claude", "projects", "repo");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.jsonl`), [
    JSON.stringify({ type: "user", message: { role: "user", content: "add capture command" } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: {} }] } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: {} }] } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Write", input: {} }] } }),
  ].join("\n"));
}

const planner: PlannerBackend = {
  name: "mock",
  async ask() {
    return JSON.stringify({
      title: "Capture command",
      body: "Capture command SOP.",
      facts: [],
      repro: [],
      resolution: "Use finalize to create the SOP.",
      triggers: ["capture"],
    });
  },
};

async function cli(root: string, args: string[], env: NodeJS.ProcessEnv = {}, lines: string[] = []): Promise<string> {
  await runCli(root, args, { log: (line) => lines.push(line), error: (line) => lines.push(line) }, env, { resourcePlanner: planner });
  return lines.join("\n");
}

describe("capture CLI dispatch", () => {
  it("auto capture no-ops outside gproj workspaces without output", async () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-"));
    const lines: string[] = [];

    await cli(root, ["resources", "capture", "--auto", "--session", "missing"], {}, lines);

    expect(lines).toEqual([]);
  });

  it("captures, lists, finalizes, and discards through the CLI", async () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-"));
    const home = mkdtempSync(join(tmpdir(), "gproj-home-"));
    mkdirSync(join(root, ".gproj"), { recursive: true });
    transcript(home, "s1");
    transcript(home, "s2");

    const captureOutput = await cli(root, ["resources", "capture", "--session", "s1"], { HOME: home });
    const pending = listPendingCaptures(root)[0];
    expect(captureOutput).toContain("capture pending:");

    const listOutput = await cli(root, ["resources", "capture", "list"], { HOME: home });
    expect(listOutput).toContain(pending.id);

    const finalizeOutput = await cli(root, ["resources", "capture", "finalize", pending.id], { HOME: home });
    expect(finalizeOutput).toContain("capture finalized:");
    expect(getAll(root)).toHaveLength(1);

    const discardCapture = await cli(root, ["resources", "capture", "--session", "s2"], { HOME: home });
    const discardId = listPendingCaptures(root)[0].id;
    expect(discardCapture).toContain(discardId);
    const discardOutput = await cli(root, ["resources", "capture", "discard", discardId], { HOME: home });
    expect(discardOutput).toContain("capture discarded:");
    expect(listPendingCaptures(root)).toEqual([]);
  });

  it("installs the hook through the CLI using HOME", async () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-"));
    const home = mkdtempSync(join(tmpdir(), "gproj-home-"));

    const output = await cli(root, ["resources", "capture", "install-hook"], { HOME: home });

    expect(output).toContain(hookCommand);
    const settingsPath = join(home, ".claude", "settings.json");
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(settings.hooks.Stop[0].hooks[0].command).toBe(hookCommand);
  });
});
