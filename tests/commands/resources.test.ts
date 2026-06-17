import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../src/cli.js";
import { resourcesBundleDir, resourcesManifestPath } from "../../src/format/paths.js";
import { type ResourceCard } from "../../src/format/schema.js";
import { getAll, writeAll } from "../../src/resources/manifest.js";
import { renderOkfBundle } from "../../src/resources/okf.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

async function runResources(args: string[]): Promise<string> {
  const lines: string[] = [];
  await runCli(root, ["resources", ...args], { log: (line) => lines.push(line), error: () => undefined });
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

  it("filters list output by category", async () => {
    writeFileSync(join(root, "note.md"), "# Note\nbody\n");
    await runResources(["add", "note.md"]);
    const [card] = getAll(root);

    expect(await runResources(["list", "--category", "documents"])).toContain(card.title);
    expect(await runResources(["list", "--category=missing"])).toBe("resources: none");
  });

  it("returns a controlled error for an unknown id", async () => {
    await expect(runResources(["show", "missing"])).rejects.toThrow("resource not found: missing");
  });

  it("organises files, links resources, and runs resource doctor", async () => {
    writeFileSync(join(root, "a.md"), "# A\nbody\n");
    writeFileSync(join(root, "b.md"), "# B\nbody\n");

    const organiseOutput = await runResources(["organise"]);
    const cards = getAll(root);

    expect(organiseOutput).toContain("imports: 2");
    expect(cards).toHaveLength(2);

    const from = cards.find((card) => card.title === "a");
    const to = cards.find((card) => card.title === "b");
    expect(from).toBeDefined();
    expect(to).toBeDefined();

    const linkOutput = await runResources(["link", from?.id ?? "", "references", to?.id ?? ""]);
    expect(linkOutput).toContain("resource linked:");
    expect(readFileSync(join(resourcesBundleDir(root), "documents", `${from?.id}.md`), "utf8")).toContain("- references:");
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
});
