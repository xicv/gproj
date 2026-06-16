import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BEST_EFFORT_FETCH_WARNING,
  fetch as cloudFetch,
  list,
  parseFencedCodeBlock,
  push,
  type CloudSyncSpawn,
} from "../../src/backends/cloudSync.js";

const url = "https://chatgpt.com/g/project";

describe("cloud sync backend", () => {
  it("constructs push argv with multiple files and preserves path spaces", async () => {
    const calls: Array<{ cmd: string[]; cwd?: string }> = [];
    const spawnFn: CloudSyncSpawn = async (cmd, opts) => {
      calls.push({ cmd, cwd: opts?.cwd });
      return { stdout: JSON.stringify({ status: "ok" }), stderr: "", exitCode: 0 };
    };

    const result = await push([".gproj/GOAL.md", ".gproj/file with spaces.md"], { chatgptUrl: url }, spawnFn, { cwd: "/repo" });

    expect(calls).toEqual([{
      cmd: [
        "oracle",
        "project-sources",
        "add",
        "--file",
        ".gproj/GOAL.md",
        ".gproj/file with spaces.md",
        "--chatgpt-url",
        url,
        "--json",
      ],
      cwd: "/repo",
    }]);
    expect(result.response).toEqual({ status: "ok" });
    expect(result.fileCount).toBe(2);
  });

  it("constructs list argv", async () => {
    let captured: string[] = [];
    const spawnFn: CloudSyncSpawn = async (cmd) => {
      captured = cmd;
      return { stdout: JSON.stringify({ sources: [] }), stderr: "", exitCode: 0 };
    };

    await list({ chatgptUrl: url }, spawnFn);

    expect(captured).toEqual(["oracle", "project-sources", "list", "--chatgpt-url", url, "--json"]);
  });

  it("reports invalid JSON with raw stdout", async () => {
    const spawnFn: CloudSyncSpawn = async () => ({ stdout: "not json", stderr: "", exitCode: 0 });

    await expect(list({ chatgptUrl: url }, spawnFn)).rejects.toMatchObject({
      code: "invalid_json",
      stdout: "not json",
      raw: "not json",
    });
  });

  it("reports non-zero oracle exits with stdout and stderr preserved", async () => {
    const spawnFn: CloudSyncSpawn = async () => ({ stdout: "partial stdout", stderr: "bad stderr", exitCode: 7 });

    await expect(list({ chatgptUrl: url }, spawnFn)).rejects.toMatchObject({
      code: "oracle_failed",
      stdout: "partial stdout",
      stderr: "bad stderr",
      exitCode: 7,
    });
  });

  it("reports spawn failures", async () => {
    const spawnFn: CloudSyncSpawn = async () => {
      throw new Error("ENOENT");
    };

    await expect(list({ chatgptUrl: url }, spawnFn)).rejects.toMatchObject({
      code: "spawn_failed",
    });
  });

  it("validates config and files before spawning", async () => {
    let calls = 0;
    const spawnFn: CloudSyncSpawn = async () => {
      calls += 1;
      return { stdout: "{}", stderr: "", exitCode: 0 };
    };

    await expect(list(undefined, spawnFn)).rejects.toMatchObject({ code: "missing_config" });
    await expect(list({}, spawnFn)).rejects.toMatchObject({ code: "missing_chatgpt_url" });
    await expect(push([], { chatgptUrl: url }, spawnFn)).rejects.toMatchObject({ code: "no_files" });
    expect(calls).toBe(0);
  });

  it("parses fenced fetch output and writes the requested file", async () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-fetch-"));
    const calls: string[][] = [];
    const spawnFn: CloudSyncSpawn = async (cmd) => {
      calls.push(cmd);
      return { stdout: "Answer:\n```md\n# Restored\nbody\n```\nfooter", stderr: "", exitCode: 0 };
    };

    const result = await cloudFetch([".gproj/notes.md"], { chatgptUrl: url }, { spawnFn, cwd: root });

    expect(readFileSync(join(root, ".gproj", "notes.md"), "utf8")).toBe("# Restored\nbody\n");
    expect(result.written).toEqual([{ file: ".gproj/notes.md", path: join(root, ".gproj", "notes.md") }]);
    expect(result.warnings).toEqual([BEST_EFFORT_FETCH_WARNING]);
    expect(calls[0]).toEqual([
      "oracle",
      "--chatgpt-url",
      url,
      "-p",
      "Output the exact verbatim content of the project source named .gproj/notes.md in a single fenced code block, and nothing else.",
    ]);
  });

  it("does not overwrite existing fetch targets unless force is passed", async () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-fetch-"));
    const target = join(root, "existing.md");
    writeFileSync(target, "local\n");
    let calls = 0;
    const spawnFn: CloudSyncSpawn = async () => {
      calls += 1;
      return { stdout: "```text\nremote\n```", stderr: "", exitCode: 0 };
    };

    const skipped = await cloudFetch(["existing.md"], { chatgptUrl: url }, { spawnFn, cwd: root });

    expect(skipped.skipped).toEqual([{ file: "existing.md", path: target, reason: "exists; pass --force to overwrite" }]);
    expect(readFileSync(target, "utf8")).toBe("local\n");
    expect(calls).toBe(0);

    const forced = await cloudFetch(["existing.md"], { chatgptUrl: url }, { spawnFn, cwd: root, force: true });

    expect(forced.written).toEqual([{ file: "existing.md", path: target }]);
    expect(readFileSync(target, "utf8")).toBe("remote\n");
    expect(calls).toBe(1);
  });

  it("rejects fetch output without a fenced code block", () => {
    expect(() => parseFencedCodeBlock("plain text")).toThrow(/fenced code block/);
    expect(existsSync("/definitely/not/created")).toBe(false);
  });
});
