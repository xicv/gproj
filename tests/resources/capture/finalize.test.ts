import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlannerBackend } from "../../../src/backends/planner.js";
import type { ResourceCard } from "../../../src/format/schema.js";
import { buildDigest } from "../../../src/resources/capture/digest.js";
import { finalizePendingCapture } from "../../../src/resources/capture/finalize.js";
import { makePendingCapture, persistPendingCapture, readPendingCapture } from "../../../src/resources/capture/pending.js";
import type { TranscriptSlice } from "../../../src/resources/capture/transcript.js";
import { getAll, writeAll } from "../../../src/resources/manifest.js";

function debugSlice(): TranscriptSlice {
  return {
    sessionId: "s1",
    transcriptPath: "/tmp/s1.jsonl",
    events: [
      { kind: "user_prompt", line: 1, text: "fix broken login error" },
      { kind: "tool_use", line: 2, toolName: "Read", input: {} },
      { kind: "tool_use", line: 3, toolName: "Grep", input: {} },
      { kind: "tool_use", line: 4, toolName: "Edit", input: {} },
      { kind: "tool_result", line: 5, toolName: "Edit", ok: false, text: "token=abcXYZ1234567890abcXYZ1234567890" },
    ],
    sourceLines: { from: 1, to: 5 },
    advance: null,
    parseErrors: 0,
    reset: false,
  };
}

function planner(output: unknown): PlannerBackend {
  return {
    name: "mock",
    async ask() {
      return typeof output === "string" ? output : JSON.stringify(output);
    },
  };
}

function writePending(root: string) {
  const slice = debugSlice();
  const pending = makePendingCapture(root, slice, buildDigest(slice), { now: new Date("2026-06-18T00:00:00.000Z") });
  persistPendingCapture(root, pending, null);
  return pending;
}

describe("capture finalize", () => {
  it("creates a validated local SOP card and deletes the pending capture", async () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-"));
    const pending = writePending(root);

    const result = await finalizePendingCapture(root, pending.id, {
      planner: planner({
        title: "Fix login error",
        body: "Reproduce the login failure, then apply the patch. token=abcXYZ1234567890abcXYZ1234567890",
        facts: ["Edit failed before the final fix."],
        repro: ["Run login flow"],
        resolution: "Patch login handler",
        triggers: ["login", "error"],
      }),
      now: new Date("2026-06-18T01:00:00.000Z"),
    });

    expect(result.action).toBe("added");
    expect(result.card).toMatchObject({ type: "sop", kind: "debug", visibility: "local" });
    expect(result.card.body).not.toContain("abcXYZ1234567890abcXYZ1234567890");
    expect(getAll(root)).toHaveLength(1);
    expect(() => readPendingCapture(root, pending.id)).toThrow(/not found/);
  });

  it("rejects planner injection and preserves pending captures", async () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-"));
    const pending = writePending(root);

    await expect(finalizePendingCapture(root, pending.id, {
      planner: planner({
        title: "Injected",
        body: "body",
        repro: ["step"],
        resolution: "done",
        triggers: [],
        visibility: "shared",
      }),
    })).rejects.toThrow();

    expect(readPendingCapture(root, pending.id).id).toBe(pending.id);
    expect(getAll(root)).toHaveLength(0);
  });

  it("requires an explicit duplicate decision and can refine an existing card", async () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-"));
    const pending = writePending(root);
    const existing: ResourceCard = {
      id: "existing-sop",
      type: "sop",
      title: "Existing SOP",
      category: "sop",
      tags: ["sop"],
      timestamp: "2026-06-18T00:00:00.000Z",
      body: "old",
      kind: "debug",
      triggers: ["login"],
      captureMeta: {
        sessionId: "old",
        fingerprint: pending.digest.fingerprint,
        toolSequence: [],
        capturedAt: "2026-06-18T00:00:00.000Z",
      },
    };
    writeAll(root, [existing]);
    const mockPlanner = planner({
      title: "Refined login SOP",
      body: "new body",
      facts: [],
      repro: ["Run login flow"],
      resolution: "Apply fix",
      triggers: ["login"],
    });

    await expect(finalizePendingCapture(root, pending.id, { planner: mockPlanner })).rejects.toThrow(/--add or --refine/);
    expect(readPendingCapture(root, pending.id).id).toBe(pending.id);

    const refined = await finalizePendingCapture(root, pending.id, { planner: mockPlanner, decision: "refine", refineId: "existing-sop" });

    expect(refined.action).toBe("refined");
    expect(getAll(root)).toHaveLength(1);
    expect(getAll(root)[0]).toMatchObject({ id: "existing-sop", title: "Refined login SOP" });
  });
});
