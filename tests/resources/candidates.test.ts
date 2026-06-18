import { describe, expect, it } from "vitest";
import type { ResourceCard } from "../../src/format/schema.js";
import { relatedCandidates } from "../../src/resources/candidates.js";

function card(id: string, overrides: Partial<ResourceCard> = {}): ResourceCard {
  return {
    id,
    type: "text",
    title: `Resource ${id}`,
    category: "docs",
    tags: [],
    timestamp: "2026-06-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("relatedCandidates", () => {
  it("ranks stronger overlap first, drops zero-score cards, and returns reasons", () => {
    const source = card("source", {
      tags: ["MQTT", "RC"],
      intent: "debug remote controller connection",
    });
    const strong = card("strong", {
      title: "Strong match",
      tags: ["mqtt", "rc"],
      category: "docs",
      intent: "remote controller workflow",
    });
    const weak = card("weak", {
      title: "Weak match",
      tags: ["mqtt"],
      category: "other",
    });
    const zero = card("zero", {
      title: "Unrelated",
      tags: ["billing"],
      category: "other",
      intent: "invoice payment export",
    });

    const result = relatedCandidates(source, [source, weak, zero, strong]);

    expect(result.map((candidate) => candidate.id)).toEqual(["strong", "weak"]);
    expect(result[0].score).toBeGreaterThan(result[1].score);
    expect(result[0].reasons).toContain("tags: mqtt, rc");
    expect(result[0].reasons).toContain("same category");
    expect(result[0].reasons.some((reason) => reason.startsWith("intent:"))).toBe(true);
  });

  it("sorts tied candidates by id for deterministic output", () => {
    const source = card("source", { tags: ["mqtt"], category: "docs" });
    const result = relatedCandidates(source, [
      source,
      card("zeta", { tags: ["MQTT"], category: "other" }),
      card("alpha", { tags: ["mqtt"], category: "other" }),
    ]);

    expect(result.map((candidate) => candidate.id)).toEqual(["alpha", "zeta"]);
  });

  it("scores owns and schemaSource overlap case-insensitively", () => {
    const source = card("source", {
      owns: { symbols: ["AuthService"], endpoints: [], configKeys: ["auth.retry"] },
      schemaSource: ["src/auth.ts:AuthService"],
    });
    const result = relatedCandidates(source, [
      source,
      card("target", {
        owns: { symbols: ["authservice"], endpoints: [], configKeys: [] },
        schemaSource: ["SRC/AUTH.TS:AUTHSERVICE"],
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(8);
    expect(result[0].reasons).toContain("owns: AuthService");
    expect(result[0].reasons).toContain("schemaSource: src/auth.ts:AuthService");
  });
});
