import { describe, it, expect } from "vitest";
import { StateSchema, DecisionSchema, RunSchema, ResourceCardSchema } from "../../src/format/schema.js";

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
  it("parses a valid resource card", () => {
    const card = ResourceCardSchema.parse({
      id: "r1",
      type: "text",
      title: "Resource",
      category: "documents",
      tags: [],
      timestamp: "2026-06-17T00:00:00.000Z",
      body: "body",
      contentHash: "abc",
      intent: "auth error handling",
      owns: {
        symbols: ["AuthService.login"],
        endpoints: ["POST /login"],
        configKeys: ["auth.retry"],
      },
      schemaSource: ["src/auth.ts:AuthService"],
    });
    expect(card.id).toBe("r1");
    expect(card.intent).toBe("auth error handling");
    expect(card.owns?.symbols).toEqual(["AuthService.login"]);
    expect(card.schemaSource).toEqual(["src/auth.ts:AuthService"]);
  });
  it("rejects a resource card missing required fields", () => {
    expect(() => ResourceCardSchema.parse({
      id: "r1",
      type: "text",
      title: "Resource",
      tags: [],
      timestamp: "2026-06-17T00:00:00.000Z",
    })).toThrow();
  });
  it("rejects invalid resource retrieval metadata shapes", () => {
    expect(() => ResourceCardSchema.parse({
      id: "r1",
      type: "text",
      title: "Resource",
      category: "documents",
      tags: [],
      timestamp: "2026-06-17T00:00:00.000Z",
      owns: { symbols: ["A"], endpoints: [] },
    })).toThrow();
    expect(() => ResourceCardSchema.parse({
      id: "r1",
      type: "text",
      title: "Resource",
      category: "documents",
      tags: [],
      timestamp: "2026-06-17T00:00:00.000Z",
      schemaSource: "src/auth.ts:AuthService",
    })).toThrow();
  });
});
