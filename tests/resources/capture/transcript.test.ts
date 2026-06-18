import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sliceTranscript } from "../../../src/resources/capture/transcript.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeTranscript(home: string, sessionId: string, lines: string[]): string {
  const dir = join(home, ".claude", "projects", "repo");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sessionId}.jsonl`);
  writeFileSync(path, lines.join("\n"));
  return path;
}

describe("capture transcript", () => {
  it("discovers Claude JSONL, parses prompts/tools/results, and skips malformed records", () => {
    const home = mkdtempSync(join(tmpdir(), "gproj-home-"));
    writeTranscript(home, "s1", [
      JSON.stringify({ type: "user", message: { role: "user", content: "fix failing login" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: { file_path: "src/login.ts" } }] } }),
      JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "ok", is_error: false }] } }),
      "{partial",
    ]);

    const slice = sliceTranscript("s1", undefined, { home });

    expect(slice?.events.map((event) => event.kind)).toEqual(["user_prompt", "tool_use", "tool_result"]);
    expect(slice?.events[1]).toMatchObject({ toolName: "Read", input: { file_path: "src/login.ts" } });
    expect(slice?.parseErrors).toBe(1);
    expect(slice?.advance?.lastLine).toBe(3);
    expect(slice?.sourceLines).toEqual({ from: 1, to: 3 });
  });

  it("slices from a valid bookmark and resets on rotation or truncation", () => {
    const home = mkdtempSync(join(tmpdir(), "gproj-home-"));
    const path = writeTranscript(home, "s2", [
      JSON.stringify({ type: "user", message: { role: "user", content: "implement capture" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: {} }] } }),
    ]);
    const first = sliceTranscript("s2", undefined, { home });
    expect(first?.advance).toBeTruthy();

    writeFileSync(path, [
      JSON.stringify({ type: "user", message: { role: "user", content: "implement capture" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: {} }] } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: {} }] } }),
    ].join("\n"));
    const second = sliceTranscript("s2", first?.advance ?? undefined, { home });
    expect(second?.events.map((event) => event.toolName)).toEqual(["Edit"]);
    expect(second?.sourceLines).toEqual({ from: 3, to: 3 });

    writeFileSync(path, JSON.stringify({ type: "user", message: { role: "user", content: "rotated" } }));
    const rotated = sliceTranscript("s2", second?.advance ?? undefined, { home });
    expect(rotated?.reset).toBe(true);
    expect(rotated?.sourceLines.from).toBe(1);
  });

  it("does not advance bookmarks past a trailing partial write", () => {
    const home = mkdtempSync(join(tmpdir(), "gproj-home-"));
    const firstLine = JSON.stringify({ type: "user", message: { role: "user", content: "start capture" } });
    const lastCompleteLine = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: {} }] } });
    writeTranscript(home, "s3", [
      firstLine,
      lastCompleteLine,
      '{"type":"user","message":{"role":"user","content":"part',
    ]);

    const slice = sliceTranscript("s3", undefined, { home });

    expect(slice?.events.map((event) => event.line)).toEqual([1, 2]);
    expect(slice?.parseErrors).toBe(1);
    expect(slice?.advance?.lastLine).toBe(2);
    expect(slice?.advance?.lastLineHash).toBe(sha256(lastCompleteLine));
    expect(slice?.sourceLines).toEqual({ from: 1, to: 2 });
  });
});
