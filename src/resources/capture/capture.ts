import { existsSync } from "node:fs";
import { appendJournal } from "../../format/journal.js";
import { gprojDir } from "../../format/paths.js";
import { buildDigest } from "./digest.js";
import {
  advanceBookmark,
  appendCaptureLog,
  makePendingCapture,
  persistPendingCapture,
  readBookmark,
  type PendingCapture,
} from "./pending.js";
import { sliceTranscript } from "./transcript.js";

export type CaptureStatus = "pending" | "skipped" | "missing-transcript" | "outside-repo" | "error";

export interface CaptureOptions {
  sessionId?: string;
  auto?: boolean;
  home?: string;
  now?: Date;
  cwd?: string;
}

export interface CaptureResult {
  status: CaptureStatus;
  pending?: PendingCapture;
  reason?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasGproj(root: string): boolean {
  return existsSync(gprojDir(root));
}

function captureSessionUnsafe(root: string, options: CaptureOptions): CaptureResult {
  if (!hasGproj(root)) return { status: "outside-repo" };
  const sessionId = options.sessionId?.trim();
  if (!sessionId) {
    if (options.auto) return { status: "skipped", reason: "missing session id" };
    throw new Error("usage: gproj resources capture --session <id>");
  }

  const bookmark = readBookmark(root, sessionId);
  const slice = sliceTranscript(sessionId, bookmark, { home: options.home });
  if (!slice) return { status: "missing-transcript", reason: `transcript not found for session ${sessionId}` };

  const digest = buildDigest(slice);
  if (!digest.substantive) {
    if (slice.advance) advanceBookmark(root, sessionId, slice.advance);
    appendJournal(root, { phase: 0, event: "capture-pending", status: "skipped", detail: digest.skipReason ?? "substantive gate failed" });
    return { status: "skipped", reason: digest.skipReason };
  }

  const pending = makePendingCapture(root, slice, digest, { now: options.now, cwd: options.cwd });
  persistPendingCapture(root, pending, slice.advance);
  appendJournal(root, { phase: 0, event: "capture-pending", status: "pending", detail: pending.id });
  return { status: "pending", pending };
}

export function captureSession(root: string, options: CaptureOptions): CaptureResult {
  if (!options.auto) return captureSessionUnsafe(root, options);
  try {
    return captureSessionUnsafe(root, options);
  } catch (error) {
    if (hasGproj(root)) {
      try {
        appendCaptureLog(root, errorMessage(error));
      } catch {
        // Auto capture must never block the caller, including on log failures.
      }
    }
    return { status: "error", reason: errorMessage(error) };
  }
}

export function renderCaptureResult(result: CaptureResult): string {
  switch (result.status) {
    case "pending":
      return `capture pending: ${result.pending?.id ?? ""}`.trim();
    case "skipped":
      return `capture skipped: ${result.reason ?? "not substantive"}`;
    case "missing-transcript":
      return `capture: ${result.reason ?? "missing transcript"}`;
    case "outside-repo":
      return "capture: not a gproj workspace";
    case "error":
      return `capture failed: ${result.reason ?? "unknown error"}`;
  }
}
