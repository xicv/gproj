import { describe, expect, it } from "vitest";
import { buildDigest } from "../../../src/resources/capture/digest.js";
import type { TranscriptSlice } from "../../../src/resources/capture/transcript.js";

function slice(events: TranscriptSlice["events"]): TranscriptSlice {
  return {
    sessionId: "s1",
    transcriptPath: "/tmp/s1.jsonl",
    events,
    sourceLines: { from: 1, to: events.length },
    advance: null,
    parseErrors: 0,
    reset: false,
  };
}

describe("capture digest", () => {
  it("classifies debug with debug winning ties and builds a deterministic fingerprint", () => {
    const input = slice([
      { kind: "user_prompt", line: 1, text: "fix broken sqlite error in https://user:secret@example.test/logs" },
      { kind: "tool_use", line: 2, toolName: "Read", input: { file_path: "src/db.ts" } },
      { kind: "tool_use", line: 3, toolName: "Grep", input: { pattern: "error" } },
      { kind: "tool_use", line: 4, toolName: "Edit", input: { file_path: "src/db.ts", password: "secret-value" } },
      { kind: "tool_result", line: 5, toolName: "Edit", ok: false, text: "password=secret-value failed" },
    ]);

    const first = buildDigest(input);
    const second = buildDigest(input);

    expect(first.substantive).toBe(true);
    expect(first.classification).toBe("debug");
    expect(first.digest.toolSequence).toEqual(["Read", "Grep", "Edit"]);
    expect(first.digest.environment.files).toContain("src/db.ts");
    expect(first.digest.environment.urls?.[0]).toContain("[REDACTED:secret]");
    expect(first.digest.steps.join("\n")).not.toContain("secret-value");
    expect(first.digest.fingerprint).toBe(second.digest.fingerprint);
  });

  it("fails the substantive gate when there are fewer than three tool calls", () => {
    const result = buildDigest(slice([
      { kind: "user_prompt", line: 1, text: "implement this feature" },
      { kind: "tool_use", line: 2, toolName: "Read", input: {} },
      { kind: "tool_use", line: 3, toolName: "Edit", input: {} },
    ]));

    expect(result.substantive).toBe(false);
    expect(result.skipReason).toContain("fewer than 3 tool calls");
  });
});
