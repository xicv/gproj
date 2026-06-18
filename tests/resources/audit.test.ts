import { describe, expect, it } from "vitest";
import { type ResourceCard } from "../../src/format/schema.js";
import { auditCards } from "../../src/resources/audit.js";

function card(id: string, overrides: Partial<ResourceCard> = {}): ResourceCard {
  return {
    id,
    type: "text",
    title: id,
    category: "docs",
    tags: [],
    timestamp: "2026-06-18T00:00:00.000Z",
    ...overrides,
  };
}

function fixture(): ResourceCard[] {
  return [
    card("a", {
      category: "specs",
      tags: ["alpha", "shared"],
      enrichedAt: "2026-06-18T00:00:00.000Z",
      intent: "pair a to b",
      links: [
        { rel: "references", toId: "b" },
        { rel: "references", toId: "b" },
      ],
    }),
    card("b", {
      category: "specs",
      tags: ["shared"],
      enrichedAt: "2026-06-18T00:00:00.000Z",
      owns: { symbols: ["SymbolB"], endpoints: [], configKeys: [] },
    }),
    card("c", {
      category: "docs",
      tags: ["beta"],
      enrichedAt: "2026-06-18T00:00:00.000Z",
      links: [{ rel: "depends-on", toId: "d" }],
      schemaSource: ["src/c.ts:SymbolC"],
    }),
    card("d", {
      category: "docs",
      schemaSource: ["src/d.ts:SymbolD"],
    }),
    card("e", {
      category: "notes",
      links: [{ rel: "references", toId: "missing" }],
    }),
    card("f", {
      category: "notes",
      links: [{ rel: "relates-to", toId: "f" }],
    }),
  ];
}

describe("resources audit", () => {
  it("computes deterministic coverage, connectivity, integrity, and distribution metrics", () => {
    const report = auditCards(fixture());

    expect(report.coverage.total).toBe(6);
    expect(report.coverage.enrichedAt).toEqual({ count: 3, percentage: 50 });
    expect(report.coverage.linked).toEqual({ count: 4, percentage: 66.67 });
    expect(report.coverage.tagged).toEqual({ count: 3, percentage: 50 });
    expect(report.coverage.intent).toEqual({ count: 1, percentage: 16.67 });
    expect(report.coverage.owns).toEqual({ count: 1, percentage: 16.67 });
    expect(report.coverage.schemaSource).toEqual({ count: 2, percentage: 33.33 });

    expect(report.connectivity.orphans).toEqual(["e", "f"]);
    expect(report.connectivity.componentCount).toBe(4);
    expect(report.connectivity.largestComponentSize).toBe(2);
    expect(report.connectivity.largestComponentPct).toBe(33.33);
    expect(report.connectivity.avgDegree).toBe(0.67);
    expect(report.connectivity.maxDegree).toBe(1);
    expect(report.connectivity.density).toBe(0.1333);
    expect(report.connectivity.hubs.slice(0, 4)).toEqual([
      { id: "a", degree: 1 },
      { id: "b", degree: 1 },
      { id: "c", degree: 1 },
      { id: "d", degree: 1 },
    ]);

    expect(report.integrity.danglingLinks).toEqual({
      count: 1,
      sample: [{ fromId: "e", rel: "references", toId: "missing" }],
    });
    expect(report.integrity.selfLinks).toBe(1);
    expect(report.integrity.duplicateLinks).toBe(1);
    expect(report.distribution.categoryHistogram).toEqual({ docs: 2, notes: 2, specs: 2 });
    expect(report.distribution.topTags).toEqual([
      { tag: "shared", count: 2 },
      { tag: "alpha", count: 1 },
      { tag: "beta", count: 1 },
    ]);
    expect(report.flags).toContain("2 orphan cards (0 links)");
    expect(report.flags).toContain("graph in 4 components");
  });

  it("lowers health score when orphan rate increases", () => {
    const base = fixture();
    const withMoreOrphans = [...base, card("g")];

    expect(auditCards(withMoreOrphans).healthScore).toBeLessThan(auditCards(base).healthScore);
  });
});
