import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../src/cli.js";
import type { CloudSyncSpawn } from "../../src/backends/cloudSync.js";
import { loadConfig } from "../../src/config/projectConfig.js";
import { resolveCloudSyncState, resolveIncludedFiles } from "../../src/commands/sync.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

function writeConfig(cloudSync: unknown): void {
  mkdirSync(join(root, ".gproj"), { recursive: true });
  writeFileSync(join(root, ".gproj", "config.json"), JSON.stringify({ cloudSync }));
}

async function runSyncCli(args: string[], spawnFn: CloudSyncSpawn): Promise<string> {
  const lines: string[] = [];
  await runCli(root, ["sync", ...args], { log: (line) => lines.push(line), error: () => undefined }, {}, { cloudSyncSpawn: spawnFn });
  return lines.join("\n");
}

describe("sync command", () => {
  it("resolves default cloud sync config and excludes backend.json", () => {
    writeConfig({ chatgptUrl: "https://chatgpt.com/g/project" });
    writeFileSync(join(root, ".gproj", "GOAL.md"), "goal\n");
    writeFileSync(join(root, ".gproj", "backend.json"), "{}\n");

    const state = resolveCloudSyncState(loadConfig(root));

    expect(state).toMatchObject({
      configured: true,
      enabled: true,
      chatgptUrl: "https://chatgpt.com/g/project",
      include: [".gproj/**"],
      canExecute: true,
    });
    expect(resolveIncludedFiles(root, state.include)).toEqual([".gproj/GOAL.md", ".gproj/config.json"]);
  });

  it("reports disabled and missing-url config states", () => {
    writeConfig({ enabled: false, chatgptUrl: "https://chatgpt.com/g/project" });
    expect(resolveCloudSyncState(loadConfig(root))).toMatchObject({
      configured: true,
      enabled: false,
      canExecute: false,
      noOpReason: "cloudSync disabled",
    });

    writeConfig({});
    expect(resolveCloudSyncState(loadConfig(root))).toMatchObject({
      configured: true,
      enabled: true,
      canExecute: false,
      noOpReason: "cloudSync.chatgptUrl missing",
    });
  });

  it("uses custom include globs for push", async () => {
    writeConfig({ chatgptUrl: "https://chatgpt.com/g/project", include: [".gproj/*.md"] });
    writeFileSync(join(root, ".gproj", "GOAL.md"), "goal\n");
    writeFileSync(join(root, ".gproj", "notes.md"), "notes\n");
    writeFileSync(join(root, ".gproj", "backend.json"), "{}\n");
    let captured: string[] = [];
    const spawnFn: CloudSyncSpawn = async (cmd) => {
      captured = cmd;
      return { stdout: JSON.stringify({ status: "ok" }), stderr: "", exitCode: 0 };
    };

    const output = await runSyncCli(["push"], spawnFn);

    expect(captured).toEqual([
      "oracle",
      "project-sources",
      "add",
      "--file",
      ".gproj/GOAL.md",
      ".gproj/notes.md",
      "--chatgpt-url",
      "https://chatgpt.com/g/project",
      "--json",
    ]);
    expect(output).toContain("files uploaded: 2");
    expect(output).toContain(".gproj/GOAL.md");
    expect(output).not.toContain("backend.json");
  });

  it("lists remote sources with the oracle list command", async () => {
    writeConfig({ chatgptUrl: "https://chatgpt.com/g/project" });
    let captured: string[] = [];
    const spawnFn: CloudSyncSpawn = async (cmd) => {
      captured = cmd;
      return { stdout: JSON.stringify({ sources: [{ name: ".gproj/GOAL.md" }] }), stderr: "", exitCode: 0 };
    };

    const output = await runSyncCli(["list"], spawnFn);

    expect(captured).toEqual(["oracle", "project-sources", "list", "--chatgpt-url", "https://chatgpt.com/g/project", "--json"]);
    expect(output).toContain("remote sources: 1");
    expect(output).toContain(".gproj/GOAL.md");
  });

  it("prints status config diagnostics plus a remote snapshot", async () => {
    writeConfig({ chatgptUrl: "https://chatgpt.com/g/project" });
    const spawnFn: CloudSyncSpawn = async () => ({
      stdout: JSON.stringify({ files: [".gproj/STATUS.md"] }),
      stderr: "",
      exitCode: 0,
    });

    const output = await runSyncCli(["status"], spawnFn);

    expect(output).toContain("configured: yes");
    expect(output).toContain("enabled: yes");
    expect(output).toContain("chatgptUrl configured: yes");
    expect(output).toContain("execution: oracle list executed");
    expect(output).toContain(".gproj/STATUS.md");
    expect(output).toContain("does not verify local/remote parity");
  });

  it("safe-no-ops when cloudSync is absent or disabled", async () => {
    let calls = 0;
    const spawnFn: CloudSyncSpawn = async () => {
      calls += 1;
      return { stdout: "{}", stderr: "", exitCode: 0 };
    };

    expect(await runSyncCli(["push"], spawnFn)).toContain("no-op (cloudSync not configured)");
    writeConfig({ enabled: false, chatgptUrl: "https://chatgpt.com/g/project" });
    expect(await runSyncCli(["list"], spawnFn)).toContain("no-op (cloudSync disabled)");
    expect(calls).toBe(0);
  });

  it("blocks execution when chatgptUrl is missing", async () => {
    writeConfig({});
    let calls = 0;
    const spawnFn: CloudSyncSpawn = async () => {
      calls += 1;
      return { stdout: "{}", stderr: "", exitCode: 0 };
    };

    await expect(runSyncCli(["push"], spawnFn)).rejects.toThrow(/chatgptUrl/);
    expect(calls).toBe(0);
  });

  it("reports no matching push files without invoking oracle", async () => {
    writeConfig({ chatgptUrl: "https://chatgpt.com/g/project", include: [".gproj/missing-*.md"] });
    let calls = 0;
    const spawnFn: CloudSyncSpawn = async () => {
      calls += 1;
      return { stdout: "{}", stderr: "", exitCode: 0 };
    };

    const output = await runSyncCli(["push"], spawnFn);

    expect(output).toContain("no matching files");
    expect(calls).toBe(0);
  });

  it("fetches a requested source with the best-effort warning", async () => {
    writeConfig({ chatgptUrl: "https://chatgpt.com/g/project" });
    const spawnFn: CloudSyncSpawn = async () => ({ stdout: "```md\nremote content\n```", stderr: "", exitCode: 0 });

    const output = await runSyncCli(["fetch", ".gproj/from-remote.md"], spawnFn);

    expect(output).toContain("BEST-EFFORT");
    expect(output).toContain("files written: 1");
    expect(readFileSync(join(root, ".gproj", "from-remote.md"), "utf8")).toBe("remote content\n");
  });

  it("does not overwrite fetched files without --force", async () => {
    writeConfig({ chatgptUrl: "https://chatgpt.com/g/project" });
    writeFileSync(join(root, "local.md"), "local\n");
    let calls = 0;
    const spawnFn: CloudSyncSpawn = async () => {
      calls += 1;
      return { stdout: "```md\nremote\n```", stderr: "", exitCode: 0 };
    };

    const output = await runSyncCli(["fetch", "local.md"], spawnFn);

    expect(output).toContain("skipped local.md");
    expect(readFileSync(join(root, "local.md"), "utf8")).toBe("local\n");
    expect(calls).toBe(0);
  });
});
