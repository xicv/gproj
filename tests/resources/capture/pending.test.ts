import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDigest } from "../../../src/resources/capture/digest.js";
import {
  discardPendingCapture,
  listPendingCaptures,
  makePendingCapture,
  persistPendingCapture,
  readBookmark,
  readPendingCapture,
} from "../../../src/resources/capture/pending.js";
import type { TranscriptSlice } from "../../../src/resources/capture/transcript.js";
import { resourcesPendingDir } from "../../../src/format/paths.js";

function substantiveSlice(): TranscriptSlice {
  return {
    sessionId: "s1",
    transcriptPath: "/tmp/s1.jsonl",
    events: [
      { kind: "user_prompt", line: 1, text: "implement capture workflow" },
      { kind: "tool_use", line: 2, toolName: "Read", input: {} },
      { kind: "tool_use", line: 3, toolName: "Edit", input: {} },
      { kind: "tool_use", line: 4, toolName: "Write", input: {} },
    ],
    sourceLines: { from: 1, to: 4 },
    advance: {
      transcriptPath: "/tmp/s1.jsonl",
      lastSize: 100,
      lastMtimeMs: 1,
      lastLineHash: "abc",
      lastLine: 4,
    },
    parseErrors: 0,
    reset: false,
  };
}

describe("pending captures", () => {
  it("writes, reads, lists, bookmarks, and discards pending captures", () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-"));
    const slice = substantiveSlice();
    const pending = makePendingCapture(root, slice, buildDigest(slice), { now: new Date("2026-06-18T00:00:00.000Z") });

    persistPendingCapture(root, pending, slice.advance);

    expect(readPendingCapture(root, pending.id)).toEqual(pending);
    expect(listPendingCaptures(root).map((capture) => capture.id)).toEqual([pending.id]);
    expect(readBookmark(root, "s1")).toEqual(slice.advance);
    expect(readdirSync(resourcesPendingDir(root)).some((name) => name.includes(".tmp-"))).toBe(false);

    const discarded = discardPendingCapture(root, pending.id);

    expect(discarded.id).toBe(pending.id);
    expect(existsSync(join(resourcesPendingDir(root), `${pending.id}.json`))).toBe(false);
  });

  it("rejects pending records with unredacted secret-like content", () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-"));
    const slice = substantiveSlice();
    const pending = makePendingCapture(root, slice, buildDigest(slice), { now: new Date("2026-06-18T00:00:00.000Z") });

    expect(() => persistPendingCapture(root, {
      ...pending,
      digest: {
        ...pending.digest,
        userPrompts: ["password=plain-secret-value"],
      },
    }, null)).toThrow(/unredacted/);
  });
});
