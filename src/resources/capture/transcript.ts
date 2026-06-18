import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type TranscriptEventKind = "user_prompt" | "tool_use" | "tool_result";

export interface TranscriptEvent {
  kind: TranscriptEventKind;
  line: number;
  text?: string;
  toolName?: string;
  input?: unknown;
  ok?: boolean;
}

export interface TranscriptBookmarkEntry {
  transcriptPath: string;
  lastSize: number;
  lastMtimeMs: number;
  lastLineHash: string;
  lastLine: number;
}

export interface TranscriptSlice {
  sessionId: string;
  transcriptPath: string;
  events: TranscriptEvent[];
  sourceLines: { from: number; to: number };
  advance: TranscriptBookmarkEntry | null;
  parseErrors: number;
  reset: boolean;
}

export interface TranscriptOptions {
  home?: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        const record = asRecord(item);
        if (!record) return "";
        if (typeof record.text === "string") return record.text;
        if (typeof record.content === "string") return record.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

function contentItems(record: Record<string, unknown>): unknown[] {
  const message = asRecord(record.message);
  const content = message?.content ?? record.content;
  return Array.isArray(content) ? content : [content].filter((item) => item !== undefined);
}

function recordRole(record: Record<string, unknown>): string | undefined {
  const message = asRecord(record.message);
  const role = message?.role ?? record.role ?? record.type;
  return typeof role === "string" ? role : undefined;
}

function toolNameFromRecord(record: Record<string, unknown>, item?: Record<string, unknown>): string {
  const name = item?.name ?? item?.tool_name ?? record.name ?? record.tool_name;
  return typeof name === "string" && name.trim() ? name : "unknown";
}

function toolInputFromRecord(record: Record<string, unknown>, item?: Record<string, unknown>): unknown {
  if (item && "input" in item) return item.input;
  if ("input" in record) return record.input;
  return undefined;
}

function parseToolUse(record: Record<string, unknown>, line: number): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  if (record.type === "tool_use") {
    events.push({ kind: "tool_use", line, toolName: toolNameFromRecord(record), input: toolInputFromRecord(record) });
  }
  for (const item of contentItems(record)) {
    const entry = asRecord(item);
    if (!entry || entry.type !== "tool_use") continue;
    events.push({ kind: "tool_use", line, toolName: toolNameFromRecord(record, entry), input: toolInputFromRecord(record, entry) });
  }
  return events;
}

function parseToolResult(record: Record<string, unknown>, line: number): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  if (record.type === "tool_result") {
    events.push({
      kind: "tool_result",
      line,
      toolName: toolNameFromRecord(record),
      text: stringFromContent(record.content),
      ok: record.is_error === true ? false : true,
    });
  }
  for (const item of contentItems(record)) {
    const entry = asRecord(item);
    if (!entry || entry.type !== "tool_result") continue;
    events.push({
      kind: "tool_result",
      line,
      toolName: toolNameFromRecord(record, entry),
      text: stringFromContent(entry.content),
      ok: entry.is_error === true ? false : true,
    });
  }
  return events;
}

function parseUserPrompt(record: Record<string, unknown>, line: number): TranscriptEvent[] {
  const role = recordRole(record);
  if (role !== "user") return [];
  const items = contentItems(record);
  if (items.some((item) => asRecord(item)?.type === "tool_result")) return [];
  const text = stringFromContent(items).trim();
  return text ? [{ kind: "user_prompt", line, text }] : [];
}

function parseTranscriptEvents(record: Record<string, unknown>, line: number): TranscriptEvent[] {
  return [
    ...parseUserPrompt(record, line),
    ...parseToolUse(record, line),
    ...parseToolResult(record, line),
  ];
}

function validateBookmark(lines: string[], path: string, bookmark?: TranscriptBookmarkEntry): { startLine: number; reset: boolean } {
  if (!bookmark) return { startLine: 0, reset: false };
  if (bookmark.transcriptPath !== path) return { startLine: 0, reset: true };
  if (bookmark.lastLine < 0 || bookmark.lastLine > lines.length) return { startLine: 0, reset: true };
  if (bookmark.lastLine === 0) return { startLine: 0, reset: false };
  const bookmarkedLine = lines[bookmark.lastLine - 1];
  if (bookmarkedLine === undefined || sha256(bookmarkedLine) !== bookmark.lastLineHash) return { startLine: 0, reset: true };
  return { startLine: bookmark.lastLine, reset: false };
}

export function locateTranscript(sessionId: string, options: TranscriptOptions = {}): string | null {
  const base = join(options.home ?? homedir(), ".claude", "projects");
  if (!existsSync(base)) return null;
  for (const project of readdirSync(base).sort()) {
    const candidate = join(base, project, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function sliceTranscript(
  sessionId: string,
  bookmark?: TranscriptBookmarkEntry,
  options: TranscriptOptions = {},
): TranscriptSlice | null {
  const transcriptPath = locateTranscript(sessionId, options);
  if (!transcriptPath) return null;

  const content = readFileSync(transcriptPath, "utf8");
  const stat = statSync(transcriptPath);
  const allLines = content.split(/\n/);
  if (allLines.at(-1) === "") allLines.pop();

  const truncated = Boolean(bookmark && stat.size < bookmark.lastSize);
  const mtimeRolledBack = Boolean(bookmark && stat.mtimeMs < bookmark.lastMtimeMs);
  const validated = truncated || mtimeRolledBack ? { startLine: 0, reset: true } : validateBookmark(allLines, transcriptPath, bookmark);
  const events: TranscriptEvent[] = [];
  let parseErrors = 0;
  let lastParsedLine = validated.startLine;
  let lastParsedLineHash = validated.startLine > 0 ? sha256(allLines[validated.startLine - 1] ?? "") : "";

  for (let index = validated.startLine; index < allLines.length; index += 1) {
    const line = allLines[index];
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      parseErrors += 1;
      continue;
    }
    const record = asRecord(raw);
    if (!record) {
      parseErrors += 1;
      continue;
    }
    lastParsedLine = index + 1;
    lastParsedLineHash = sha256(line);
    events.push(...parseTranscriptEvents(record, index + 1));
  }

  const advance = lastParsedLine > validated.startLine
    ? {
        transcriptPath,
        lastSize: stat.size,
        lastMtimeMs: stat.mtimeMs,
        lastLineHash: lastParsedLineHash,
        lastLine: lastParsedLine,
      }
    : null;

  return {
    sessionId,
    transcriptPath,
    events,
    sourceLines: {
      from: validated.startLine + 1,
      to: lastParsedLine,
    },
    advance,
    parseErrors,
    reset: validated.reset || truncated || mtimeRolledBack,
  };
}
