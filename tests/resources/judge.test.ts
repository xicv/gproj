import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlannerUnavailableError, type PlannerAsk, type PlannerBackend } from "../../src/backends/planner.js";
import type { ResourceCard } from "../../src/format/schema.js";
import { judgeLinks } from "../../src/resources/judge.js";
import { writeAll } from "../../src/resources/manifest.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

function card(id: string, overrides: Partial<ResourceCard> = {}): ResourceCard {
  return {
    id,
    type: "text",
    title: `Resource ${id}`,
    category: "docs",
    tags: [],
    timestamp: "2026-06-18T00:00:00.000Z",
    excerpt: `excerpt ${id}`,
    ...overrides,
  };
}

function planner(responder: (req: PlannerAsk, call: number) => string): PlannerBackend {
  let calls = 0;
  return {
    name: "mock",
    async ask(req) {
      calls += 1;
      return responder(req, calls);
    },
  };
}

describe("resources judge", () => {
  it("aggregates fixed verdicts from a deterministic sampled link set", async () => {
    writeAll(root, [
      card("c"),
      card("a", { links: [{ rel: "references", toId: "b" }, { rel: "depends-on", toId: "c" }] }),
      card("b", { links: [{ rel: "relates-to", toId: "c" }] }),
    ]);
    const verdicts = ["correct", "weak", "incorrect"];

    const report = await judgeLinks(root, {
      sample: 3,
      planner: planner((_req, call) => JSON.stringify({ verdict: verdicts[call - 1], reason: `reason ${call}` })),
    });

    expect(report.totalLinks).toBe(3);
    expect(report.sampled).toBe(3);
    expect(report.judged).toBe(3);
    expect(report.counts).toEqual({ correct: 1, weak: 1, incorrect: 1, unjudged: 0 });
    expect(report.linkPrecision).toBe(1 / 3);
    expect(report.verdicts.map((item) => `${item.fromId}:${item.toId}:${item.verdict}`)).toEqual([
      "a:b:correct",
      "a:c:weak",
      "b:c:incorrect",
    ]);
  });

  it("counts malformed planner JSON as unjudged without throwing", async () => {
    writeAll(root, [
      card("a", { links: [{ rel: "references", toId: "b" }] }),
      card("b"),
    ]);

    const report = await judgeLinks(root, {
      planner: planner(() => "{\"verdict\":\"maybe\"}"),
    });

    expect(report.judged).toBe(0);
    expect(report.counts).toEqual({ correct: 0, weak: 0, incorrect: 0, unjudged: 1 });
    expect(report.verdicts[0]).toMatchObject({ fromId: "a", toId: "b", verdict: "unjudged" });
  });

  it("halts on PlannerUnavailableError while preserving partial verdicts", async () => {
    writeAll(root, [
      card("a", { links: [{ rel: "references", toId: "b" }, { rel: "references", toId: "c" }] }),
      card("b"),
      card("c"),
    ]);

    const report = await judgeLinks(root, {
      sample: 2,
      planner: planner((_req, call) => {
        if (call === 2) throw new PlannerUnavailableError("usage limit");
        return JSON.stringify({ verdict: "correct", reason: "supported" });
      }),
    });

    expect(report.halted).toBe(true);
    expect(report.haltReason).toBe("usage limit");
    expect(report.judged).toBe(1);
    expect(report.counts).toEqual({ correct: 1, weak: 0, incorrect: 0, unjudged: 0 });
    expect(report.verdicts).toHaveLength(1);
  });
});
