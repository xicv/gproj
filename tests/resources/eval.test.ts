import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResourceCard } from "../../src/format/schema.js";
import { evalRetrieval, parseEvalSetContent } from "../../src/resources/eval.js";
import { writeAll } from "../../src/resources/manifest.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

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

describe("resources eval", () => {
  it("computes precision@k, recall, nDCG@k, and link recall from ranked find results", () => {
    writeAll(root, [
      card("a", {
        title: "AuthService.login Guide",
        owns: { symbols: ["AuthService.login"], endpoints: [], configKeys: [] },
        links: [{ rel: "references", toId: "b" }],
      }),
      card("b", { title: "Login Token Runbook", tags: ["login"] }),
      card("c", { title: "Billing Webhook", tags: ["billing"] }),
      card("d", { title: "Body Match", body: "AuthService.login appears only here" }),
    ]);

    const report = evalRetrieval(root, {
      queries: [
        { query: "AuthService.login", expectedIds: ["a", "d"] },
        { query: "login", expectedIds: ["b"] },
      ],
      links: [
        { fromId: "a", rel: "references", toId: "b" },
        { fromId: "b", rel: "depends-on", toId: "c" },
      ],
    }, { k: 2 });

    expect(report.queries[0]).toMatchObject({
      returnedIds: ["a", "d"],
      precisionAtK: 1,
      recall: 1,
      ndcgAtK: 1,
    });
    expect(report.queries[1]).toMatchObject({
      returnedIds: ["a", "b"],
      precisionAtK: 0.5,
      recall: 1,
      ndcgAtK: 0.6309,
    });
    expect(report.meanPrecisionAtK).toBe(0.75);
    expect(report.meanRecall).toBe(1);
    expect(report.meanNdcgAtK).toBe(0.8155);
    expect(report.linkRecall).toEqual({ expected: 2, found: 1, recall: 0.5 });
  });

  it("reports malformed evalsets with a Zod validation error", () => {
    expect(() => parseEvalSetContent(JSON.stringify({ queries: [{ query: "auth", expectedIds: "a" }] }), "eval.json"))
      .toThrow("eval.json: invalid EvalSet: queries.0.expectedIds: Expected array, received string");
  });
});
