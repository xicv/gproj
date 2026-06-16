import { describe, it, expect } from "vitest";
import { StateSchema, DecisionSchema, RunSchema } from "../../src/format/schema.js";

describe("schemas", () => {
  it("parses a valid state", () => {
    const s = StateSchema.parse({ currentPhase: 1, status: "planning", phases: [] });
    expect(s.currentPhase).toBe(1);
    expect(s.activeWorktree).toBe(null);
    expect(s.packageId).toBe(0);
  });
  it("rejects an unknown status", () => {
    expect(() => StateSchema.parse({ currentPhase: 1, status: "bogus", phases: [] })).toThrow();
  });
  it("parses an append-only decision record", () => {
    const d = DecisionSchema.parse({ ts: "2026-06-15T00:00:00Z", title: "use ndjson", why: "machine-ingestable" });
    expect(d.title).toBe("use ndjson");
  });
  it("parses a run evidence record", () => {
    const r = RunSchema.parse({ id: "r1", phase: 1, promptHash: "abc", changedFiles: ["a.ts"], diffStat: "+1 -0", testsPassed: true, failures: [] });
    expect(r.testsPassed).toBe(true);
    expect(r.packageId).toBe(0);
  });
});
