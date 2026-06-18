import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlannerBackend } from "../src/backends/planner.js";
import { runResources } from "../src/commands/resources.js";
import { getAll } from "../src/resources/manifest.js";
import { listPendingCaptures } from "../src/resources/capture/pending.js";

function writeTranscript(home: string, sessionId: string): void {
  const dir = join(home, ".claude", "projects", "repo");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.jsonl`), [
    JSON.stringify({ type: "user", message: { role: "user", content: "implement capture CLI" } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: { file_path: "src/commands/resources.ts" } }] } }),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "SECRET_OUTPUT_SHOULD_NOT_PERSIST", is_error: false }] } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: "src/commands/resources.ts" } }] } }),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "SECRET_OUTPUT_SHOULD_NOT_PERSIST", is_error: false }] } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Write", input: { file_path: "tests/cli.capture.test.ts" } }] } }),
  ].join("\n"));
}

const planner: PlannerBackend = {
  name: "mock",
  async ask() {
    return JSON.stringify({
      title: "Capture CLI workflow",
      body: "Use capture to create pending SOPs and finalize after review.",
      facts: ["Capture CLI was implemented."],
      repro: [],
      resolution: "Finalize creates a ResourceCard.",
      triggers: ["capture", "cli"],
    });
  },
};

describe("resources capture integration", () => {
  it("captures a transcript into pending and finalizes it into a SOP ResourceCard", async () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-"));
    const home = mkdtempSync(join(tmpdir(), "gproj-home-"));
    mkdirSync(join(root, ".gproj"), { recursive: true });
    writeTranscript(home, "session-1");

    const captureOutput = await runResources(root, ["capture", "--session", "session-1"], { home, planner });
    const pending = listPendingCaptures(root)[0];

    expect(captureOutput).toContain("capture pending:");
    expect(pending).toMatchObject({ sessionId: "session-1", classification: "feature" });
    expect(JSON.stringify(pending)).not.toContain("SECRET_OUTPUT_SHOULD_NOT_PERSIST");

    const finalizeOutput = await runResources(root, ["capture", "finalize", pending.id, "--share"], { home, planner });
    const cards = getAll(root);

    expect(finalizeOutput).toContain("capture finalized:");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ type: "sop", kind: "feature", visibility: "shared" });
    expect(listPendingCaptures(root)).toEqual([]);
  });
});
