import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlannerUnavailableError, type PlannerAsk, type PlannerBackend } from "../../src/backends/planner.js";
import { resourcesIndexPath, resourcesManifestPath } from "../../src/format/paths.js";
import type { ResourceCard } from "../../src/format/schema.js";
import { enrichResources } from "../../src/resources/enrich.js";
import { getAll, writeAll } from "../../src/resources/manifest.js";

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

function validEnrichment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tags: [],
    owns: {},
    schemaSource: [],
    links: [],
    ...overrides,
  };
}

function idsFromPack(req: PlannerAsk): string[] {
  return (JSON.parse(req.pack) as { cards: Array<{ id: string }> }).cards.map((item) => item.id);
}

function planner(responder: (req: PlannerAsk, call: number) => unknown | Promise<unknown>): PlannerBackend {
  let calls = 0;
  return {
    name: "mock",
    async ask(req) {
      calls += 1;
      const output = await responder(req, calls);
      return typeof output === "string" ? output : JSON.stringify(output);
    },
  };
}

describe("resources enrich", () => {
  it("merges validated enrichment, redacts text fields, drops unknown links, and writes bundle state", async () => {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "auth.ts"), "export class AuthService {}\n");
    writeAll(root, [
      card("r1", {
        title: "Auth Notes",
        tags: ["existing"],
        links: [{ rel: "defines", toId: "r2" }],
      }),
      card("r2", { title: "Target" }),
    ]);

    const seenPacks: Array<{ cards: unknown[]; linkTargets: Record<string, string> }> = [];
    const result = await enrichResources(root, {
      planner: planner((req) => {
        const pack = JSON.parse(req.pack) as { cards: unknown[]; linkTargets: Record<string, string> };
        seenPacks.push(pack);
        return {
          r1: validEnrichment({
            category: "docs",
            tags: ["Alpha", "token=abcXYZ1234567890abcXYZ1234567890"],
            intent: "Use Bearer abcXYZ1234567890abcXYZ1234567890",
            owns: {
              symbols: ["AuthService.login"],
              endpoints: ["POST /login"],
              configKeys: ["auth.retry"],
            },
            schemaSource: ["src/auth.ts:AuthService"],
            links: [
              { rel: "references", toId: "r2" },
              { rel: "depends-on", toId: "missing" },
              { rel: "relates-to", toId: "r2" },
            ],
            visibility: "shared",
          }),
          r2: validEnrichment(),
        };
      }),
      now: new Date("2026-06-18T01:00:00.000Z"),
    });

    const byId = new Map(getAll(root).map((item) => [item.id, item]));
    const enriched = byId.get("r1");

    expect(result.summary).toEqual({ selected: 2, enriched: 2, skipped: 0, failed: 0, unchanged: 0 });
    expect(seenPacks[0].cards).toEqual([
      {
        id: "r1",
        title: "Auth Notes",
        excerpt: "excerpt r1",
        candidates: [{ id: "r2", title: "Target", why: "same category" }],
      },
      {
        id: "r2",
        title: "Target",
        excerpt: "excerpt r2",
        candidates: [{ id: "r1", title: "Auth Notes", why: "same category" }],
      },
    ]);
    expect(seenPacks[0].linkTargets).toEqual({ r1: "Auth Notes", r2: "Target" });
    expect(enriched?.tags).toContain("alpha");
    expect(enriched?.tags.join(" ")).not.toContain("abcXYZ");
    expect(enriched?.intent).toBe("Use [REDACTED]");
    expect(enriched?.owns).toEqual({
      symbols: ["AuthService.login"],
      endpoints: ["POST /login"],
      configKeys: ["auth.retry"],
    });
    expect(enriched?.schemaSource).toEqual(["src/auth.ts:AuthService"]);
    expect(enriched?.links).toEqual([{ rel: "defines", toId: "r2" }]);
    expect(enriched?.enrichedAt).toBe("2026-06-18T01:00:00.000Z");
    expect(enriched).not.toHaveProperty("visibility", "shared");
    expect(existsSync(resourcesIndexPath(root))).toBe(true);
  });

  it("drops schemaSource that does not resolve to real code", async () => {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "auth.ts"), "export class AuthService {}\n");
    writeAll(root, [card("r1")]);

    await enrichResources(root, {
      planner: planner(() => ({
        r1: validEnrichment({
          schemaSource: ["context", "src/auth.ts:AuthService", "src/auth.ts:Missing"],
        }),
      })),
      now: new Date("2026-06-18T01:00:00.000Z"),
    });

    expect(getAll(root)[0].schemaSource).toEqual(["src/auth.ts:AuthService"]);
  });

  it("scopes by category and limit, then skips enriched cards unless reenrich is set", async () => {
    writeAll(root, [
      card("a", { title: "A" }),
      card("b", { title: "B", enrichedAt: "2026-06-18T00:00:00.000Z" }),
      card("c", { title: "C", category: "other" }),
    ]);
    const calls: string[][] = [];
    const mockPlanner = planner((req) => {
      const ids = idsFromPack(req);
      calls.push(ids);
      return Object.fromEntries(ids.map((id) => [id, validEnrichment({ tags: [id] })]));
    });

    const first = await enrichResources(root, {
      planner: mockPlanner,
      category: "docs",
      limit: 1,
      now: new Date("2026-06-18T01:00:00.000Z"),
    });
    const second = await enrichResources(root, {
      planner: planner(() => {
        throw new Error("should not be called");
      }),
      category: "docs",
    });
    const forced = await enrichResources(root, {
      planner: mockPlanner,
      category: "docs",
      limit: 1,
      reenrich: true,
      now: new Date("2026-06-18T02:00:00.000Z"),
    });

    expect(first.summary).toEqual({ selected: 1, enriched: 1, skipped: 1, failed: 0, unchanged: 0 });
    expect(second.summary).toEqual({ selected: 0, enriched: 0, skipped: 2, failed: 0, unchanged: 0 });
    expect(forced.summary).toEqual({ selected: 1, enriched: 1, skipped: 0, failed: 0, unchanged: 0 });
    expect(calls).toEqual([["a"], ["a"]]);
    expect(getAll(root).find((item) => item.id === "c")?.enrichedAt).toBeUndefined();
  });

  it("includes related candidates in the planner pack for each batch card", async () => {
    writeAll(root, [
      card("r1", {
        title: "Auth Notes",
        tags: ["auth", "login"],
        owns: { symbols: ["AuthService"], endpoints: [], configKeys: [] },
      }),
      card("r2", {
        title: "Auth Flow",
        tags: ["AUTH"],
        owns: { symbols: ["authservice"], endpoints: [], configKeys: [] },
      }),
      card("r3", {
        title: "Billing Notes",
        category: "finance",
        tags: ["invoice"],
      }),
    ]);
    let capturedPack: { cards: Array<{ id: string; candidates?: Array<{ id: string; title: string; why: string }> }> } | undefined;

    await enrichResources(root, {
      planner: planner((req) => {
        capturedPack = JSON.parse(req.pack) as typeof capturedPack;
        return Object.fromEntries(idsFromPack(req).map((id) => [id, validEnrichment()]));
      }),
      batchSize: 2,
      limit: 2,
      now: new Date("2026-06-18T01:00:00.000Z"),
    });

    const packedR1 = capturedPack?.cards.find((packedCard) => packedCard.id === "r1");
    expect(packedR1?.candidates).toEqual([
      { id: "r2", title: "Auth Flow", why: "tags: auth; same category; owns: AuthService" },
    ]);
  });

  it("defaults to batches of 8", async () => {
    writeAll(root, Array.from({ length: 9 }, (_, index) => card(`r${index + 1}`)));
    const calls: string[][] = [];

    await enrichResources(root, {
      planner: planner((req) => {
        const ids = idsFromPack(req);
        calls.push(ids);
        return Object.fromEntries(ids.map((id) => [id, validEnrichment()]));
      }),
      now: new Date("2026-06-18T01:00:00.000Z"),
    });

    expect(calls.map((ids) => ids.length)).toEqual([8, 1]);
  });

  it("honors the configured batchSize option", async () => {
    writeAll(root, Array.from({ length: 7 }, (_, index) => card(`r${index + 1}`)));
    const calls: string[][] = [];

    await enrichResources(root, {
      planner: planner((req) => {
        const ids = idsFromPack(req);
        calls.push(ids);
        return Object.fromEntries(ids.map((id) => [id, validEnrichment()]));
      }),
      batchSize: 3,
      now: new Date("2026-06-18T01:00:00.000Z"),
    });

    expect(calls.map((ids) => ids.length)).toEqual([3, 3, 1]);
  });

  it("keeps dry-run side-effect free while reporting proposed changes", async () => {
    writeAll(root, [card("r1")]);
    const before = readFileSync(resourcesManifestPath(root), "utf8");

    const result = await enrichResources(root, {
      planner: planner((req) => Object.fromEntries(idsFromPack(req).map((id) => [id, validEnrichment({ tags: ["dry"] })]))),
      dryRun: true,
      now: new Date("2026-06-18T01:00:00.000Z"),
    });

    expect(result.summary).toEqual({ selected: 1, enriched: 1, skipped: 0, failed: 0, unchanged: 0 });
    expect(result.events.some((event) => event.event === "card-change")).toBe(true);
    expect(readFileSync(resourcesManifestPath(root), "utf8")).toBe(before);
    expect(getAll(root)[0].enrichedAt).toBeUndefined();
    expect(existsSync(resourcesIndexPath(root))).toBe(false);
  });

  it("drops planner-proposed self-links", async () => {
    writeAll(root, [card("r1")]);

    await enrichResources(root, {
      planner: planner(() => ({
        r1: validEnrichment({ links: [{ rel: "references", toId: "r1" }] }),
      })),
      now: new Date("2026-06-18T01:00:00.000Z"),
    });

    expect(getAll(root)[0].links?.some((link) => link.toId === "r1")).not.toBe(true);
  });

  it("sanitizes schemaSource entries", async () => {
    writeAll(root, [card("r1")]);

    await enrichResources(root, {
      planner: planner(() => ({
        r1: validEnrichment({ schemaSource: ["src/x.ts:Foo token=abcXYZ1234567890abcXYZ1234567890"] }),
      })),
      now: new Date("2026-06-18T01:00:00.000Z"),
    });

    expect(getAll(root)[0].schemaSource?.join(" ") ?? "").not.toContain("abcXYZ1234567890abcXYZ1234567890");
    expect(getAll(root)[0].schemaSource).toEqual([]);
  });

  it("skips invalid planner batches and continues with later batches", async () => {
    writeAll(root, [card("r1"), card("r2"), card("r3")]);

    const result = await enrichResources(root, {
      planner: planner((req) => {
        const [id] = idsFromPack(req);
        if (id === "r1") return { r1: validEnrichment({ tags: "not-array" }) };
        return { [id]: validEnrichment({ tags: [id] }) };
      }),
      batchSize: 1,
      now: new Date("2026-06-18T01:00:00.000Z"),
    });

    const byId = new Map(getAll(root).map((item) => [item.id, item]));
    expect(result.summary).toEqual({ selected: 3, enriched: 2, skipped: 0, failed: 1, unchanged: 0 });
    expect(result.events.find((event) => event.event === "batch-failed")?.reason).toContain("invalid enrichment for r1");
    expect(byId.get("r1")?.enrichedAt).toBeUndefined();
    expect(byId.get("r2")?.enrichedAt).toBe("2026-06-18T01:00:00.000Z");
    expect(byId.get("r3")?.enrichedAt).toBe("2026-06-18T01:00:00.000Z");
  });

  it("resumes after a failed batch without duplicating links", async () => {
    writeAll(root, [card("r1"), card("r2")]);

    await enrichResources(root, {
      planner: planner((req) => {
        const [id] = idsFromPack(req);
        if (id === "r2") throw new Error("planner down");
        return { [id]: validEnrichment({ links: [{ rel: "references", toId: "r2" }] }) };
      }),
      batchSize: 1,
      now: new Date("2026-06-18T01:00:00.000Z"),
    });
    await enrichResources(root, {
      planner: planner((req) => {
        const [id] = idsFromPack(req);
        return { [id]: validEnrichment({ links: [{ rel: "references", toId: "r2" }] }) };
      }),
      batchSize: 1,
      now: new Date("2026-06-18T02:00:00.000Z"),
    });

    const byId = new Map(getAll(root).map((item) => [item.id, item]));
    expect(byId.get("r1")?.enrichedAt).toBe("2026-06-18T01:00:00.000Z");
    expect(byId.get("r2")?.enrichedAt).toBe("2026-06-18T02:00:00.000Z");
    expect(byId.get("r1")?.links?.filter((link) => link.toId === "r2")).toHaveLength(1);
  });

  it("halts on planner unavailability after preserving committed batches", async () => {
    writeAll(root, [card("r1"), card("r2"), card("r3")]);
    const calls: string[][] = [];

    const result = await enrichResources(root, {
      planner: planner((req, call) => {
        const ids = idsFromPack(req);
        calls.push(ids);
        if (call >= 2) throw new PlannerUnavailableError("oracle-browser failed: usage limit");
        return { r1: validEnrichment({ tags: ["first"] }) };
      }),
      batchSize: 1,
      now: new Date("2026-06-18T01:00:00.000Z"),
    });

    const byId = new Map(getAll(root).map((item) => [item.id, item]));
    expect(calls).toEqual([["r1"], ["r2"]]);
    expect(result.summary).toEqual({
      selected: 3,
      enriched: 1,
      skipped: 0,
      failed: 0,
      unchanged: 0,
      halted: true,
      haltReason: "oracle-browser failed: usage limit",
    });
    expect(result.events.find((event) => event.event === "halted")).toEqual({
      event: "halted",
      reason: "oracle-browser failed: usage limit",
    });
    expect(byId.get("r1")?.tags).toContain("first");
    expect(byId.get("r1")?.enrichedAt).toBe("2026-06-18T01:00:00.000Z");
    expect(byId.get("r2")?.enrichedAt).toBeUndefined();
    expect(byId.get("r3")?.enrichedAt).toBeUndefined();
  });

  it("keeps planner calls within the configured concurrency limit", async () => {
    writeAll(root, [card("r1"), card("r2"), card("r3"), card("r4")]);
    let active = 0;
    let maxActive = 0;

    await enrichResources(root, {
      planner: planner(async (req) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        const [id] = idsFromPack(req);
        return { [id]: validEnrichment() };
      }),
      batchSize: 1,
      concurrency: 2,
      now: new Date("2026-06-18T01:00:00.000Z"),
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(getAll(root).every((item) => item.enrichedAt === "2026-06-18T01:00:00.000Z")).toBe(true);
  });
});
