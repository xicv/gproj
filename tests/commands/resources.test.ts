import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../src/cli.js";
import { resourcesBundleDir, resourcesManifestPath } from "../../src/format/paths.js";
import { getAll } from "../../src/resources/manifest.js";

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
});
