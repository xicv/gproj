import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlannerBackend } from "../../src/backends/planner.js";
import { runCli } from "../../src/cli.js";
import { resourcesBundleDir, resourcesIndexPath, resourcesManifestPath } from "../../src/format/paths.js";
import { type ResourceCard } from "../../src/format/schema.js";
import { getAll, writeAll } from "../../src/resources/manifest.js";
import { renderOkfBundle } from "../../src/resources/okf.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

async function runResources(args: string[], deps: { resourcePlanner?: PlannerBackend } = {}): Promise<string> {
  const lines: string[] = [];
  await runCli(root, ["resources", ...args], { log: (line) => lines.push(line), error: () => undefined }, {}, deps);
  return lines.join("\n");
}

describe("resources command", () => {
  it("adds, lists, and shows a local resource", async () => {
    writeFileSync(join(root, "note.md"), "# Note\nbody\n");

    const addOutput = await runResources(["add", "note.md"]);
    const cards = getAll(root);
    const [card] = cards;

    expect(addOutput).toContain("resource added:");
    expect(cards).toHaveLength(1);
    expect(existsSync(resourcesManifestPath(root))).toBe(true);

    const listOutput = await runResources(["list"]);
    expect(listOutput).toContain(card.id);
    expect(listOutput).toContain(card.title);

    const showOutput = await runResources(["show", card.id]);
    expect(JSON.parse(showOutput)).toMatchObject({ id: card.id, title: card.title });
    expect(existsSync(join(resourcesBundleDir(root), "documents", `${card.id}.md`))).toBe(true);
  });

  it("applies metadata flags when adding a local resource", async () => {
    writeFileSync(join(root, "note.md"), "# Note\nbody\n");

    await runResources([
      "add",
      "--category",
      "dji-cloud-api",
      "--title",
      "Cloud API Spec",
      "--type",
      "spec",
      "--tags",
      " Alpha, beta,alpha ",
      "--link",
      "references:target-1",
      "--link",
      "depends-on:target-2",
      "--intent",
      "auth error handling",
      "--owns-symbol",
      "AuthService.login",
      "--owns-endpoint",
      "POST /login",
      "--owns-config",
      "auth.retry",
      "--schema-source",
      "src/auth.ts:AuthService",
      "note.md",
    ]);

    const [card] = getAll(root);
    expect(card).toMatchObject({
      category: "dji-cloud-api",
      title: "Cloud API Spec",
      type: "spec",
      tags: ["alpha", "beta"],
      links: [
        { rel: "references", toId: "target-1" },
        { rel: "depends-on", toId: "target-2" },
      ],
      intent: "auth error handling",
      owns: {
        symbols: ["AuthService.login"],
        endpoints: ["POST /login"],
        configKeys: ["auth.retry"],
      },
      schemaSource: ["src/auth.ts:AuthService"],
    });
    expect(card.id).toMatch(/^cloud-api-spec-/);
    const markdown = readFileSync(join(resourcesBundleDir(root), "dji-cloud-api", `${card.id}.md`), "utf8");
    expect(markdown).toContain("type: \"spec\"");
    expect(markdown).toContain("category: \"dji-cloud-api\"");
    expect(markdown).toContain("intent: \"auth error handling\"");
    expect(markdown).toContain("    - \"AuthService.login\"");
    expect(existsSync(resourcesIndexPath(root))).toBe(true);
  });

  it("rejects malformed add link flags", async () => {
    writeFileSync(join(root, "note.md"), "# Note\nbody\n");

    await expect(runResources(["add", "--link", "references", "note.md"])).rejects.toThrow("invalid --link value");
    await expect(runResources(["add", "--link", "invalid:target", "note.md"])).rejects.toThrow("invalid relation type: invalid");
  });

  it("filters list output by category", async () => {
    writeFileSync(join(root, "note.md"), "# Note\nbody\n");
    await runResources(["add", "note.md"]);
    const [card] = getAll(root);

    expect(await runResources(["list", "--category", "documents"])).toContain(card.title);
    expect(await runResources(["list", "--category=missing"])).toBe("resources: none");
  });

  it("ranks find results by owns, intent, title, tags, then body with stable reasons", async () => {
    const cards: ResourceCard[] = [
      {
        id: "body",
        type: "text",
        title: "Body Only",
        category: "docs",
        tags: [],
        timestamp: "2026-06-17T00:00:00.000Z",
        body: "mentions AuthService.login only in the body",
      },
      {
        id: "tag",
        type: "text",
        title: "Tagged",
        category: "docs",
        tags: ["AuthService.login"],
        timestamp: "2026-06-17T00:00:00.000Z",
      },
      {
        id: "title",
        type: "text",
        title: "AuthService.login Guide",
        category: "docs",
        tags: [],
        timestamp: "2026-06-17T00:00:00.000Z",
      },
      {
        id: "intent",
        type: "text",
        title: "Intent",
        category: "docs",
        tags: [],
        timestamp: "2026-06-17T00:00:00.000Z",
        intent: "AuthService.login request flow",
      },
      {
        id: "owns",
        type: "text",
        title: "Owns",
        category: "docs",
        tags: [],
        timestamp: "2026-06-17T00:00:00.000Z",
        owns: { symbols: ["AuthService.login"], endpoints: [], configKeys: [] },
      },
    ];
    writeAll(root, cards);
    renderOkfBundle(root, cards);

    const first = await runResources(["find", "AuthService.login"]);
    const second = await runResources(["find", "AuthService.login"]);
    const lines = first.split("\n");

    expect(second).toBe(first);
    expect(lines.map((line) => line.split("\t")[0])).toEqual(["owns", "intent", "title", "tag", "body"]);
    expect(lines[0]).toContain("match=owns.symbols:AuthService.login");
    expect(lines[0]).toContain("field=owns.symbols");
  });

  it("caps find results with --limit and returns all results with --all", async () => {
    const cards: ResourceCard[] = Array.from({ length: 3 }, (_, index) => ({
      id: `r${index + 1}`,
      type: "text",
      title: `Auth Result ${index + 1}`,
      category: "docs",
      tags: [],
      timestamp: "2026-06-17T00:00:00.000Z",
    }));
    writeAll(root, cards);
    renderOkfBundle(root, cards);

    expect((await runResources(["find", "--limit", "2", "Auth"])).split("\n")).toHaveLength(2);
    expect((await runResources(["find", "--all", "Auth"])).split("\n")).toHaveLength(3);
  });

  it("runs judged audit through the resources command", async () => {
    writeAll(root, [
      {
        id: "a",
        type: "text",
        title: "A",
        category: "docs",
        tags: [],
        timestamp: "2026-06-18T00:00:00.000Z",
        links: [{ rel: "references", toId: "b" }],
      },
      {
        id: "b",
        type: "text",
        title: "B",
        category: "docs",
        tags: [],
        timestamp: "2026-06-18T00:00:00.000Z",
      },
    ]);
    const planner: PlannerBackend = {
      name: "mock",
      async ask() {
        return JSON.stringify({ verdict: "correct", reason: "specific" });
      },
    };

    const output = await runResources(["audit", "--judge", "--sample", "1"], { resourcePlanner: planner });

    expect(output).toContain("resources audit: healthScore");
    expect(output).toContain("link precision (judged 1): 100% correct, 0 weak, 0 incorrect");
  });

  it("runs retrieval eval through the resources command", async () => {
    writeAll(root, [{
      id: "auth",
      type: "text",
      title: "Auth Login",
      category: "docs",
      tags: [],
      timestamp: "2026-06-18T00:00:00.000Z",
    }]);
    const evalset = join(root, "evalset.json");
    writeFileSync(evalset, JSON.stringify({ queries: [{ query: "auth", expectedIds: ["auth"] }] }));

    const output = await runResources(["eval", evalset]);

    expect(output).toContain("resources eval: 1 queries, k=10");
    expect(output).toContain("mean recall: 100%");
  });

  it("returns a controlled error for an unknown id", async () => {
    await expect(runResources(["show", "missing"])).rejects.toThrow("resource not found: missing");
  });

  it("resolves schemaSource pointers with the schema command", async () => {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "auth.ts"), [
      "export class AuthService {}",
      "export function login() {}",
      "export const duplicate = 1;",
      "const duplicate = 2;",
    ].join("\n"));
    writeAll(root, [{
      id: "auth",
      type: "text",
      title: "Auth",
      category: "docs",
      tags: [],
      timestamp: "2026-06-17T00:00:00.000Z",
      schemaSource: [
        "src/auth.ts:AuthService",
        "src/auth.ts:missing",
        "src/missing.ts:AuthService",
        "src/auth.ts:duplicate",
      ],
    }]);

    const output = await runResources(["schema", "auth"]);

    expect(output).toContain("src/auth.ts:1\tAuthService");
    expect(output).toContain("warning: src/auth.ts:missing: missing symbol");
    expect(output).toContain("warning: src/missing.ts:AuthService: missing file");
    expect(output).toContain("warning: src/auth.ts:duplicate: ambiguous match (2)");
  });

  it("keeps valid schemaSource through organise, enrich, and schema lookup", async () => {
    mkdirSync(join(root, "docs"), { recursive: true });
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "docs", "valid.md"), "# Valid\nbody\n");
    writeFileSync(join(root, "src", "x.ts"), "export class Real {}\n");

    await runResources(["organise", "docs"]);
    const [card] = getAll(root);
    const planner: PlannerBackend = {
      name: "mock",
      async ask(req) {
        const ids = (JSON.parse(req.pack) as { cards: Array<{ id: string }> }).cards.map((item) => item.id);
        return JSON.stringify(Object.fromEntries(ids.map((id) => [id, {
          tags: [],
          owns: {},
          schemaSource: ["context", "src/x.ts:Real", "src/x.ts:Nope"],
          links: [],
        }])));
      },
    };

    await runResources(["enrich"], { resourcePlanner: planner });
    const output = await runResources(["schema", card.id]);

    expect(getAll(root)[0].schemaSource).toEqual(["src/x.ts:Real"]);
    expect(output).toBe("src/x.ts:1\tReal");
  });

  it("generates the index cache on demand", async () => {
    writeAll(root, [{
      id: "r1",
      type: "text",
      title: "Resource",
      category: "docs",
      tags: ["alpha"],
      timestamp: "2026-06-17T00:00:00.000Z",
      intent: "lookup hint",
      owns: { symbols: ["SymbolOne"], endpoints: [], configKeys: [] },
      schemaSource: ["src/one.ts:SymbolOne"],
    }]);

    expect(await runResources(["index"])).toBe(".gproj/resources/.okf-index.json");
    const index = JSON.parse(readFileSync(resourcesIndexPath(root), "utf8"));
    expect(index).toEqual([expect.objectContaining({
      id: "r1",
      intent: "lookup hint",
      owns: { symbols: ["SymbolOne"], endpoints: [], configKeys: [] },
      schemaSource: ["src/one.ts:SymbolOne"],
      resource: "docs/r1.md",
      links: [],
    })]);
  });

  it("prints parseable JSON for resources audit --json", async () => {
    writeAll(root, [
      {
        id: "r1",
        type: "text",
        title: "Resource One",
        category: "docs",
        tags: ["alpha"],
        timestamp: "2026-06-18T00:00:00.000Z",
        links: [{ rel: "references", toId: "r2" }],
        enrichedAt: "2026-06-18T00:00:00.000Z",
      },
      {
        id: "r2",
        type: "text",
        title: "Resource Two",
        category: "docs",
        tags: [],
        timestamp: "2026-06-18T00:00:00.000Z",
      },
    ]);

    const report = JSON.parse(await runResources(["audit", "--json"]));

    expect(report).toEqual(expect.objectContaining({
      coverage: expect.any(Object),
      connectivity: expect.any(Object),
      integrity: expect.any(Object),
      distribution: expect.any(Object),
      healthScore: expect.any(Number),
      flags: expect.any(Array),
    }));
    expect(report.coverage.total).toBe(2);
    expect(report.connectivity.componentCount).toBe(1);
  });

  it("organises files, links resources, and runs resource doctor", async () => {
    writeFileSync(join(root, "a.md"), "# A\nbody\n");
    writeFileSync(join(root, "b.md"), "# B\nbody\n");

    const organiseOutput = await runResources(["organise"]);
    const cards = getAll(root);

    expect(organiseOutput).toContain("imports: 2");
    expect(cards).toHaveLength(2);
    expect(existsSync(resourcesIndexPath(root))).toBe(true);

    const from = cards.find((card) => card.title === "a");
    const to = cards.find((card) => card.title === "b");
    expect(from).toBeDefined();
    expect(to).toBeDefined();

    const linkOutput = await runResources(["link", from?.id ?? "", "references", to?.id ?? ""]);
    expect(linkOutput).toContain("resource linked:");
    const categoryDir = (from?.category ?? "").toLowerCase();
    expect(readFileSync(join(resourcesBundleDir(root), categoryDir, `${from?.id}.md`), "utf8")).toContain(`- [b](../${categoryDir}/${to?.id}.md)`);
    expect(JSON.parse(readFileSync(resourcesIndexPath(root), "utf8")).find((entry: { id: string }) => entry.id === from?.id)?.links).toEqual([{ toId: to?.id }]);
    expect(await runResources(["doctor"])).toBe("resources doctor: ok");
  });

  it("removes a resource, inbound links, and unshared assets", async () => {
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "assets", "one.bin"), Buffer.from([1]));
    writeFileSync(join(root, "ref.md"), "ref\n");
    await runResources(["add", "assets/one.bin"]);
    await runResources(["add", "ref.md"]);
    let cards = getAll(root);
    const asset = cards.find((card) => card.type === "binary");
    const ref = cards.find((card) => card.type === "text");
    expect(asset?.resource).toBeDefined();
    await runResources(["link", ref?.id ?? "", "depends-on", asset?.id ?? ""]);

    const output = await runResources(["rm", asset?.id ?? ""]);
    cards = getAll(root);

    expect(output).toContain("resource removed:");
    expect(cards.some((card) => card.id === asset?.id)).toBe(false);
    expect(cards.find((card) => card.id === ref?.id)?.links).toBeUndefined();
    expect(existsSync(join(resourcesBundleDir(root), asset?.resource ?? ""))).toBe(false);
    expect(JSON.parse(readFileSync(resourcesIndexPath(root), "utf8")).some((entry: { id: string }) => entry.id === asset?.id)).toBe(false);
  });

  it("preserves shared assets when removing one referencing card", async () => {
    const shared = "_assets/shared.bin";
    const cards: ResourceCard[] = ["a1", "a2"].map((id) => ({
      id,
      type: "binary",
      title: id,
      category: "assets",
      tags: [],
      timestamp: "2026-06-17T00:00:00.000Z",
      resource: shared,
      sourcePaths: [`${id}.bin`],
      contentHash: "1".repeat(64),
    }));
    mkdirSync(join(resourcesBundleDir(root), "_assets"), { recursive: true });
    writeFileSync(join(resourcesBundleDir(root), shared), Buffer.from([1]));
    writeAll(root, cards);
    renderOkfBundle(root, cards);

    await runResources(["rm", "a1"]);

    expect(existsSync(join(resourcesBundleDir(root), shared))).toBe(true);
    expect(getAll(root).map((card) => card.id)).toEqual(["a2"]);
  });

  it("keeps resources dry-run unlocked by the CLI", async () => {
    mkdirSync(join(root, ".gproj"), { recursive: true });
    writeFileSync(join(root, ".gproj", ".lock"), JSON.stringify({ pid: process.pid, label: "other", ts: Date.now() }));

    await expect(runResources(["organise", "--dry-run"])).resolves.toContain("resources organise (dry-run)");
  });

  it("keeps resources enrich dry-run unlocked by the CLI", async () => {
    mkdirSync(join(root, ".gproj"), { recursive: true });
    writeFileSync(join(root, ".gproj", ".lock"), JSON.stringify({ pid: process.pid, label: "other", ts: Date.now() }));
    writeAll(root, [{
      id: "r1",
      type: "text",
      title: "Resource",
      category: "docs",
      tags: [],
      timestamp: "2026-06-17T00:00:00.000Z",
    }]);

    const planner: PlannerBackend = {
      name: "mock",
      async ask() {
        return JSON.stringify({ r1: { tags: [], owns: {}, schemaSource: [], links: [] } });
      },
    };

    const output = await runResources(["enrich", "--dry-run"], { resourcePlanner: planner });

    expect(JSON.parse(output.split("\n").at(-1) ?? "{}")).toMatchObject({ event: "summary", dryRun: true, enriched: 1 });
  });
});
