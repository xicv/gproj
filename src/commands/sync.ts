import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import {
  fetch as cloudFetch,
  list as cloudList,
  push as cloudPush,
  realCloudSyncSpawn,
  status as cloudStatus,
  type CloudSyncConfig,
  type CloudSyncFetchResult,
  type CloudSyncListResult,
  type CloudSyncPushResult,
  type CloudSyncSpawn,
} from "../backends/cloudSync.js";
import { loadConfig, type GprojConfig } from "../config/projectConfig.js";
import { resourcesManifestPath, resourcesSharedManifestPath } from "../format/paths.js";
import { atomicWrite } from "../format/store.js";
import { getAll } from "../resources/manifest.js";

const DEFAULT_INCLUDE = [".gproj/**"];
const DEFAULT_EXCLUDE = ".gproj/backend.json";
const RESOURCE_MANIFEST_REL = ".gproj/resources.ndjson";
const RESOURCE_SHARED_MANIFEST_REL = ".gproj/resources.shared.ndjson";
const CAPTURE_LOG_REL = ".gproj/.g.capture.log";

export interface CloudSyncState {
  configured: boolean;
  enabled: boolean;
  chatgptUrl?: string;
  include: string[];
  canExecute: boolean;
  noOpReason?: string;
}

export interface SyncDeps {
  spawnFn?: CloudSyncSpawn;
}

interface RemoteSource {
  label: string;
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

export function resolveCloudSyncState(config: GprojConfig): CloudSyncState {
  const block = config.cloudSync;
  const configured = block !== undefined;
  const chatgptUrl = block?.chatgptUrl?.trim();
  const enabled = configured ? block?.enabled !== false : false;
  const include = block?.include ?? DEFAULT_INCLUDE;

  let noOpReason: string | undefined;
  if (!configured) noOpReason = "cloudSync not configured";
  else if (!enabled) noOpReason = "cloudSync disabled";
  else if (!chatgptUrl) noOpReason = "cloudSync.chatgptUrl missing";

  return {
    configured,
    enabled,
    chatgptUrl,
    include,
    canExecute: configured && enabled && Boolean(chatgptUrl),
    noOpReason,
  };
}

function cloudSyncConfig(state: CloudSyncState): CloudSyncConfig {
  return { chatgptUrl: state.chatgptUrl };
}

function requireExecutable(state: CloudSyncState): CloudSyncConfig | null {
  if (!state.configured) return null;
  if (!state.enabled) return null;
  if (!state.chatgptUrl) {
    throw new Error("cloud sync requires cloudSync.chatgptUrl in .gproj/config.json; oracle was not invoked");
  }
  return cloudSyncConfig(state);
}

function globBase(pattern: string): string {
  const firstGlob = pattern.search(/[*?\[]/);
  if (firstGlob === -1) return pattern;
  const prefix = pattern.slice(0, firstGlob);
  const dir = prefix.endsWith("/") || prefix.endsWith("\\") ? prefix.slice(0, -1) : dirname(prefix);
  return dir === "." ? "" : dir;
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
  const normalized = toPosix(pattern);
  let source = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (char === "*") {
      if (normalized[i + 1] === "*") {
        source += ".*";
        i += 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegex(char);
    }
  }
  source += "$";
  return new RegExp(source);
}

function hasGlob(pattern: string): boolean {
  return /[*?\[]/.test(pattern);
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const stat = statSync(dir);
  if (stat.isFile()) return [dir];
  if (!stat.isDirectory()) return [];

  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function writeSharedResourceProjection(root: string): void {
  if (!existsSync(resourcesManifestPath(root))) return;
  const path = resourcesSharedManifestPath(root);
  const shared = getAll(root).filter((card) => card.visibility === "shared");
  if (shared.length === 0) {
    rmSync(path, { force: true });
    return;
  }
  atomicWrite(path, shared.map((card) => JSON.stringify(card)).join("\n") + "\n");
}

function isExcludedFromPush(rel: string): boolean {
  if (rel === DEFAULT_EXCLUDE) return true;
  if (rel === RESOURCE_MANIFEST_REL) return true;
  if (rel === CAPTURE_LOG_REL) return true;
  if (rel.startsWith(".gproj/resources/")) return true;
  return false;
}

export function resolveIncludedFiles(root: string, include: string[]): string[] {
  writeSharedResourceProjection(root);
  const files = new Set<string>();
  for (const pattern of include) {
    const absolutePattern = resolve(root, pattern);
    if (!hasGlob(pattern)) {
      if (existsSync(absolutePattern) && statSync(absolutePattern).isFile()) {
        files.add(toPosix(relative(root, absolutePattern)));
      }
      continue;
    }

    const regex = globToRegExp(pattern);
    const base = resolve(root, globBase(pattern));
    for (const file of walkFiles(base)) {
      const rel = toPosix(relative(root, file));
      if (regex.test(rel)) files.add(rel);
    }
  }

  for (const rel of [...files]) {
    if (isExcludedFromPush(rel)) files.delete(rel);
  }
  if (!existsSync(resourcesSharedManifestPath(root))) files.delete(RESOURCE_SHARED_MANIFEST_REL);
  return [...files].sort();
}

function noOpMessage(verb: string, state: CloudSyncState): string {
  return `cloud sync ${verb}: no-op (${state.noOpReason ?? "not executable"})`;
}

function valuePresent(value: string | undefined): string {
  return value ? "yes" : "no";
}

function extractArray(response: unknown): unknown[] {
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== "object") return [];
  const record = response as Record<string, unknown>;
  for (const key of ["sources", "projectSources", "files", "items", "data"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

export function extractRemoteSources(response: unknown): RemoteSource[] {
  return extractArray(response).map((item, index) => {
    if (typeof item === "string") return { label: item };
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const label = record.name ?? record.path ?? record.file ?? record.title ?? record.id;
      if (typeof label === "string" && label.trim()) return { label };
    }
    return { label: `source ${index + 1}` };
  });
}

export function renderRemoteSources(response: unknown): string {
  const sources = extractRemoteSources(response);
  if (sources.length === 0) return "remote sources: none";
  return [`remote sources: ${sources.length}`, ...sources.map((source) => `- ${source.label}`)].join("\n");
}

function responseSummary(response: unknown): string {
  if (response && typeof response === "object" && !Array.isArray(response)) {
    const record = response as Record<string, unknown>;
    if (typeof record.status === "string") return `oracle response: ${record.status}`;
    const keys = Object.keys(record);
    return `oracle response: JSON received${keys.length ? ` (${keys.join(", ")})` : ""}`;
  }
  if (Array.isArray(response)) return `oracle response: JSON array (${response.length} item${response.length === 1 ? "" : "s"})`;
  return `oracle response: ${String(response)}`;
}

function renderWarnings(response: unknown): string[] {
  if (!response || typeof response !== "object") return [];
  const warnings = (response as Record<string, unknown>).warnings;
  if (!Array.isArray(warnings) || warnings.length === 0) return [];
  return warnings.map((warning) => {
    if (typeof warning === "string") return `warning: ${warning}`;
    if (warning && typeof warning === "object" && typeof (warning as Record<string, unknown>).message === "string") {
      return `warning: ${(warning as Record<string, unknown>).message}`;
    }
    return "warning: oracle returned a warning";
  });
}

function renderPush(result: CloudSyncPushResult): string {
  return [
    "cloud sync push complete",
    `files uploaded: ${result.fileCount}`,
    ...result.files.map((file) => `- ${file}`),
    responseSummary(result.response),
    ...renderWarnings(result.response),
  ].join("\n");
}

function renderList(result: CloudSyncListResult): string {
  return ["cloud sync list", renderRemoteSources(result.response)].join("\n");
}

function renderFetch(result: CloudSyncFetchResult): string {
  return [
    ...result.warnings,
    "cloud sync fetch complete",
    `files written: ${result.written.length}`,
    ...result.written.map((entry) => `- wrote ${entry.file}`),
    ...(result.skipped.length ? [`files skipped: ${result.skipped.length}`, ...result.skipped.map((entry) => `- skipped ${entry.file}: ${entry.reason}`)] : []),
  ].join("\n");
}

async function runPush(root: string, state: CloudSyncState, spawnFn: CloudSyncSpawn): Promise<string> {
  const config = requireExecutable(state);
  if (!config) return noOpMessage("push", state);
  const files = resolveIncludedFiles(root, state.include);
  if (files.length === 0) return `cloud sync push: no matching files for include globs (${state.include.join(", ")})`;
  return renderPush(await cloudPush(files, config, spawnFn, { cwd: root }));
}

async function runList(root: string, state: CloudSyncState, spawnFn: CloudSyncSpawn): Promise<string> {
  const config = requireExecutable(state);
  if (!config) return noOpMessage("list", state);
  return renderList(await cloudList(config, spawnFn, { cwd: root }));
}

async function runStatus(root: string, state: CloudSyncState, spawnFn: CloudSyncSpawn): Promise<string> {
  const lines = [
    "cloud sync status",
    `configured: ${state.configured ? "yes" : "no"}`,
    `enabled: ${state.enabled ? "yes" : "no"}`,
    `chatgptUrl configured: ${valuePresent(state.chatgptUrl)}`,
  ];

  if (!state.canExecute) {
    lines.push(`execution: no-op (${state.noOpReason ?? "not executable"})`);
    lines.push("remote snapshot: not requested");
    lines.push("status note: this does not verify local/remote parity");
    return lines.join("\n");
  }

  lines.push("execution: oracle list executed");
  const result = await cloudStatus(cloudSyncConfig(state), spawnFn, { cwd: root });
  lines.push(renderRemoteSources(result.response));
  lines.push("status note: this is a remote listing snapshot only; it does not verify local/remote parity");
  return lines.join("\n");
}

async function runFetch(root: string, state: CloudSyncState, args: string[], spawnFn: CloudSyncSpawn): Promise<string> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: { force: { type: "boolean", short: "f", default: false } },
  });
  const files = parsed.positionals;
  if (files.length === 0) {
    throw new Error("usage: gproj sync fetch [--force] <file...>");
  }
  const config = requireExecutable(state);
  if (!config) return noOpMessage("fetch", state);
  return renderFetch(await cloudFetch(files, config, {
    spawnFn,
    cwd: root,
    force: parsed.values.force === true,
  }));
}

export async function runSync(root: string, args: string[], deps: SyncDeps = {}): Promise<string> {
  const [cmd, ...rest] = args;
  const state = resolveCloudSyncState(loadConfig(root));
  const spawnFn = deps.spawnFn ?? realCloudSyncSpawn;

  switch (cmd) {
    case "push":
      return runPush(root, state, spawnFn);
    case "list":
      return runList(root, state, spawnFn);
    case "status":
      return runStatus(root, state, spawnFn);
    case "fetch":
      return runFetch(root, state, rest, spawnFn);
    default:
      throw new Error("usage: gproj sync push|list|status|fetch");
  }
}
