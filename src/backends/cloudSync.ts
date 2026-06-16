import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface CloudSyncConfig {
  chatgptUrl?: string;
}

export interface CloudSyncSpawnOptions {
  cwd?: string;
  timeoutMs?: number;
}

export interface CloudSyncSpawnResult {
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | string | null;
}

export type CloudSyncSpawn = (
  cmd: string[],
  opts?: CloudSyncSpawnOptions,
) => Promise<CloudSyncSpawnResult>;

export type CloudSyncErrorCode =
  | "missing_config"
  | "missing_chatgpt_url"
  | "no_files"
  | "spawn_failed"
  | "oracle_failed"
  | "invalid_json"
  | "invalid_fetch_response";

export interface CloudSyncErrorDetails {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | string | null;
  raw?: string;
  cause?: unknown;
}

export class CloudSyncError extends Error {
  readonly name = "CloudSyncError";
  readonly code: CloudSyncErrorCode;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number | null;
  readonly signal?: NodeJS.Signals | string | null;
  readonly raw?: string;

  constructor(code: CloudSyncErrorCode, message: string, details: CloudSyncErrorDetails = {}) {
    super(message);
    this.code = code;
    this.stdout = details.stdout;
    this.stderr = details.stderr;
    this.exitCode = details.exitCode;
    this.signal = details.signal;
    this.raw = details.raw;
    if (details.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = details.cause;
    }
  }
}

export interface CloudSyncPushResult {
  argv: string[];
  files: string[];
  fileCount: number;
  response: unknown;
  stdout: string;
  stderr: string;
}

export interface CloudSyncListResult {
  argv: string[];
  response: unknown;
  stdout: string;
  stderr: string;
}

export interface CloudSyncFetchOptions extends CloudSyncSpawnOptions {
  spawnFn: CloudSyncSpawn;
  force?: boolean;
}

export interface CloudSyncFetchResult {
  warnings: string[];
  written: Array<{ file: string; path: string }>;
  skipped: Array<{ file: string; path: string; reason: string }>;
}

export const BEST_EFFORT_FETCH_WARNING =
  "WARNING: fetch is BEST-EFFORT: oracle re-types the file through the model; it is not byte-exact, is text-only, and may truncate or drift.";

const DEFAULT_TIMEOUT_MS = 600_000;

function snippet(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  return trimmed.length > 1000 ? `${trimmed.slice(0, 1000)}...` : trimmed;
}

function requireChatgptUrl(config: CloudSyncConfig | undefined): string {
  if (!config) {
    throw new CloudSyncError("missing_config", "cloud sync config is missing");
  }
  const chatgptUrl = config.chatgptUrl?.trim();
  if (!chatgptUrl) {
    throw new CloudSyncError("missing_chatgpt_url", "cloud sync requires cloudSync.chatgptUrl in .gproj/config.json");
  }
  return chatgptUrl;
}

export function buildPushArgv(files: string[], chatgptUrl: string): string[] {
  return ["oracle", "project-sources", "add", "--file", ...files, "--chatgpt-url", chatgptUrl, "--json"];
}

export function buildListArgv(chatgptUrl: string): string[] {
  return ["oracle", "project-sources", "list", "--chatgpt-url", chatgptUrl, "--json"];
}

export function buildFetchArgv(file: string, chatgptUrl: string): string[] {
  return [
    "oracle",
    "--chatgpt-url",
    chatgptUrl,
    "-p",
    `Output the exact verbatim content of the project source named ${file} in a single fenced code block, and nothing else.`,
  ];
}

export const realCloudSyncSpawn: CloudSyncSpawn = (cmd, opts) =>
  new Promise<CloudSyncSpawnResult>((resolvePromise, rejectPromise) => {
    const [bin, ...args] = cmd;
    if (!bin) {
      rejectPromise(new Error("empty cloud sync command"));
      return;
    }

    const child = spawn(bin, args, {
      cwd: opts?.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    };
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", rejectOnce);
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      resolvePromise({ stdout, stderr, exitCode, signal });
    });
  });

async function runOracle(
  argv: string[],
  operation: string,
  spawnFn: CloudSyncSpawn,
  opts?: CloudSyncSpawnOptions,
): Promise<CloudSyncSpawnResult> {
  let result: CloudSyncSpawnResult;
  try {
    result = await spawnFn(argv, opts);
  } catch (error) {
    throw new CloudSyncError("spawn_failed", `failed to run oracle for cloud sync ${operation}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }

  const exitCode = result.exitCode ?? 0;
  const signal = result.signal ?? null;
  if (exitCode !== 0 || signal !== null) {
    const stderr = snippet(result.stderr);
    const stdout = snippet(result.stdout);
    const details = [
      `oracle cloud sync ${operation} failed (code=${exitCode}, signal=${signal ?? "none"})`,
      stderr ? `stderr: ${stderr}` : "",
      stdout ? `stdout: ${stdout}` : "",
    ].filter(Boolean).join("\n");
    throw new CloudSyncError("oracle_failed", details, {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode,
      signal,
    });
  }

  return result;
}

export function parseOracleJson(stdout: string, operation = "command"): unknown {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    const raw = snippet(stdout);
    throw new CloudSyncError("invalid_json", `oracle cloud sync ${operation} returned invalid JSON${raw ? `\nstdout: ${raw}` : ""}`, {
      stdout,
      raw: stdout,
      cause: error,
    });
  }
}

async function runOracleJson(
  argv: string[],
  operation: string,
  spawnFn: CloudSyncSpawn,
  opts?: CloudSyncSpawnOptions,
): Promise<{ response: unknown; stdout: string; stderr: string }> {
  const result = await runOracle(argv, operation, spawnFn, opts);
  return {
    response: parseOracleJson(result.stdout, operation),
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function push(
  files: string[],
  config: CloudSyncConfig | undefined,
  spawnFn: CloudSyncSpawn,
  opts?: CloudSyncSpawnOptions,
): Promise<CloudSyncPushResult> {
  const chatgptUrl = requireChatgptUrl(config);
  if (files.length === 0) {
    throw new CloudSyncError("no_files", "no resolved files for cloud sync push");
  }
  const argv = buildPushArgv(files, chatgptUrl);
  const result = await runOracleJson(argv, "push", spawnFn, opts);
  return { argv, files, fileCount: files.length, ...result };
}

export async function list(
  config: CloudSyncConfig | undefined,
  spawnFn: CloudSyncSpawn,
  opts?: CloudSyncSpawnOptions,
): Promise<CloudSyncListResult> {
  const chatgptUrl = requireChatgptUrl(config);
  const argv = buildListArgv(chatgptUrl);
  const result = await runOracleJson(argv, "list", spawnFn, opts);
  return { argv, ...result };
}

export async function status(
  config: CloudSyncConfig | undefined,
  spawnFn: CloudSyncSpawn,
  opts?: CloudSyncSpawnOptions,
): Promise<CloudSyncListResult> {
  return list(config, spawnFn, opts);
}

export function parseFencedCodeBlock(output: string): string {
  const open = /```[^\r\n]*(?:\r?\n|$)/.exec(output);
  if (!open) {
    throw new CloudSyncError("invalid_fetch_response", "oracle fetch response did not contain a fenced code block", {
      stdout: output,
      raw: output,
    });
  }

  const start = open.index + open[0].length;
  const close = output.indexOf("```", start);
  if (close === -1) {
    throw new CloudSyncError("invalid_fetch_response", "oracle fetch response did not close its fenced code block", {
      stdout: output,
      raw: output,
    });
  }

  return output.slice(start, close);
}

export async function fetch(
  files: string[],
  config: CloudSyncConfig | undefined,
  opts: CloudSyncFetchOptions,
): Promise<CloudSyncFetchResult> {
  const chatgptUrl = requireChatgptUrl(config);
  if (files.length === 0) {
    throw new CloudSyncError("no_files", "no files requested for cloud sync fetch");
  }

  const cwd = opts.cwd ?? process.cwd();
  const written: CloudSyncFetchResult["written"] = [];
  const skipped: CloudSyncFetchResult["skipped"] = [];

  for (const file of files) {
    const path = resolve(cwd, file);
    if (existsSync(path) && !opts.force) {
      skipped.push({ file, path, reason: "exists; pass --force to overwrite" });
      continue;
    }

    const argv = buildFetchArgv(file, chatgptUrl);
    const result = await runOracle(argv, "fetch", opts.spawnFn, { cwd: opts.cwd, timeoutMs: opts.timeoutMs });
    const content = parseFencedCodeBlock(result.stdout);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    written.push({ file, path });
  }

  return { warnings: [BEST_EFFORT_FETCH_WARNING], written, skipped };
}
