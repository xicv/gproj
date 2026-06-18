import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import {
  ensureParentDir,
  resourcesCaptureBookmarkPath,
  resourcesCaptureLogPath,
  resourcesPendingDir,
} from "../../format/paths.js";
import { ResourceEnvironmentSchema } from "../../format/schema.js";
import { atomicWrite } from "../../format/store.js";
import type { DigestResult } from "./digest.js";
import type { TranscriptBookmarkEntry, TranscriptSlice } from "./transcript.js";
import { containsUnredactedSecret } from "./redact.js";

const ClassificationSchema = z.enum(["debug", "research", "feature"]);
const ClassificationScoresSchema = z.object({
  debug: z.number(),
  research: z.number(),
  feature: z.number(),
}).strict();

const CaptureDigestSchema = z.object({
  steps: z.array(z.string()),
  toolSequence: z.array(z.string()),
  fingerprint: z.string(),
  environment: ResourceEnvironmentSchema,
  userPrompts: z.array(z.string()),
  facts: z.array(z.string()),
}).strict();

const PendingCaptureSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  capturedAt: z.string(),
  classification: ClassificationSchema,
  classificationScores: ClassificationScoresSchema,
  digest: CaptureDigestSchema,
  sourceLines: z.object({
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
  }).strict(),
  provenance: z.object({
    repoRoot: z.string(),
    cwd: z.string(),
    gitHead: z.string().nullable(),
    gprojVersion: z.string(),
  }).strict(),
}).strict();

const BookmarkEntrySchema = z.object({
  transcriptPath: z.string(),
  lastSize: z.number().int().nonnegative(),
  lastMtimeMs: z.number(),
  lastLineHash: z.string(),
  lastLine: z.number().int().nonnegative(),
}).strict();

const BookmarkFileSchema = z.object({
  sessions: z.record(BookmarkEntrySchema),
}).strict();

export type PendingCapture = z.infer<typeof PendingCaptureSchema>;
export type CaptureClassification = z.infer<typeof ClassificationSchema>;
export type ClassificationScores = z.infer<typeof ClassificationScoresSchema>;
export type BookmarkFile = z.infer<typeof BookmarkFileSchema>;

let tmpCounter = 0;

function compactTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 17);
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "-").slice(0, 120) || "session";
}

function tempPath(path: string): string {
  tmpCounter += 1;
  return `${path}.tmp-${process.pid}-${tmpCounter}`;
}

function atomicJsonWrite(path: string, value: unknown, validate: (raw: unknown) => void): void {
  const tmp = tempPath(path);
  const data = `${JSON.stringify(value, null, 2)}\n`;
  ensureParentDir(path);
  try {
    writeFileSync(tmp, data, { flag: "wx" });
    validate(JSON.parse(readFileSync(tmp, "utf8")));
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // Best-effort cleanup must not hide the write failure.
    }
    throw error;
  }
}

function withCaptureLock<T>(root: string, sessionId: string, fn: () => T): T {
  const dir = dirname(resourcesCaptureBookmarkPath(root));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `.capture-${safeId(sessionId)}.lock`);
  const fd = openSync(path, "wx");
  try {
    return fn();
  } finally {
    try {
      closeSync(fd);
    } finally {
      rmSync(path, { force: true });
    }
  }
}

function pendingPath(root: string, id: string): string {
  return join(resourcesPendingDir(root), `${id}.json`);
}

function gitHead(root: string): string | null {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) return null;
  const head = result.stdout.trim();
  return head || null;
}

function gprojVersion(): string {
  try {
    const packageJson = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : "unknown";
  } catch {
    return "unknown";
  }
}

function assertRedactedPending(pending: PendingCapture): void {
  if (containsUnredactedSecret(pending.digest.steps) ||
    containsUnredactedSecret(pending.digest.userPrompts) ||
    containsUnredactedSecret(pending.digest.facts) ||
    containsUnredactedSecret(pending.digest.environment)) {
    throw new Error("pending capture contains unredacted secret-like content");
  }
}

export function makePendingCapture(
  root: string,
  slice: TranscriptSlice,
  result: DigestResult,
  options: { now?: Date; cwd?: string } = {},
): PendingCapture {
  const capturedAt = (options.now ?? new Date()).toISOString();
  const id = `capture-${compactTimestamp(capturedAt)}-${result.digest.fingerprint.slice(0, 12)}`;
  return PendingCaptureSchema.parse({
    id,
    sessionId: slice.sessionId,
    capturedAt,
    classification: result.classification,
    classificationScores: result.classificationScores,
    digest: result.digest,
    sourceLines: slice.sourceLines,
    provenance: {
      repoRoot: root,
      cwd: options.cwd ?? root,
      gitHead: gitHead(root),
      gprojVersion: gprojVersion(),
    },
  });
}

export function readBookmarkFile(root: string): BookmarkFile {
  const path = resourcesCaptureBookmarkPath(root);
  if (!existsSync(path)) return { sessions: {} };
  return BookmarkFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function readBookmark(root: string, sessionId: string): TranscriptBookmarkEntry | undefined {
  return readBookmarkFile(root).sessions[sessionId];
}

export function advanceBookmark(root: string, sessionId: string, bookmark: TranscriptBookmarkEntry): void {
  withCaptureLock(root, sessionId, () => {
    const current = readBookmarkFile(root);
    atomicWrite(resourcesCaptureBookmarkPath(root), `${JSON.stringify(BookmarkFileSchema.parse({
      sessions: { ...current.sessions, [sessionId]: bookmark },
    }), null, 2)}\n`);
  });
}

export function persistPendingCapture(root: string, pending: PendingCapture, bookmark: TranscriptBookmarkEntry | null): void {
  withCaptureLock(root, pending.sessionId, () => {
    const parsed = PendingCaptureSchema.parse(pending);
    assertRedactedPending(parsed);
    mkdirSync(resourcesPendingDir(root), { recursive: true });
    atomicJsonWrite(pendingPath(root, parsed.id), parsed, (raw) => {
      PendingCaptureSchema.parse(raw);
    });
    if (bookmark) {
      const current = readBookmarkFile(root);
      atomicWrite(resourcesCaptureBookmarkPath(root), `${JSON.stringify(BookmarkFileSchema.parse({
        sessions: { ...current.sessions, [pending.sessionId]: bookmark },
      }), null, 2)}\n`);
    }
  });
}

export function listPendingCaptures(root: string): PendingCapture[] {
  const dir = resourcesPendingDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readPendingCapture(root, basename(name, ".json")))
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || a.id.localeCompare(b.id));
}

export function readPendingCapture(root: string, id: string): PendingCapture {
  const path = pendingPath(root, id);
  if (!existsSync(path)) throw new Error(`pending capture not found: ${id}`);
  return PendingCaptureSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function discardPendingCapture(root: string, id: string): PendingCapture {
  const pending = readPendingCapture(root, id);
  withCaptureLock(root, pending.sessionId, () => {
    rmSync(pendingPath(root, id), { force: true });
  });
  return pending;
}

export function appendCaptureLog(root: string, message: string): void {
  const path = resourcesCaptureLogPath(root);
  ensureParentDir(path);
  appendFileSync(path, `${new Date().toISOString()} ${message}\n`, { flag: "a" });
}
