import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resourcesManifestPath } from "../../src/format/paths.js";
import { type ResourceCard } from "../../src/format/schema.js";
import { add, getAll, writeAll } from "../../src/resources/manifest.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

function card(id: string): ResourceCard {
  return {
    id,
    type: "text",
    title: `Resource ${id}`,
    category: "documents",
    tags: [],
    timestamp: "2026-06-17T00:00:00.000Z",
    body: `body ${id}`,
  };
}

describe("resources manifest", () => {
  it("adds and persists a resource card", () => {
    const resource = card("r1");
    add(root, resource);

    expect(getAll(root)).toEqual([resource]);
  });

  it("round-trips multiple entries through NDJSON", () => {
    const resources = [card("r1"), card("r2")];
    writeAll(root, resources);

    expect(getAll(root)).toEqual(resources);
  });

  it("reports invalid cards with line numbers", () => {
    mkdirSync(join(root, ".gproj"), { recursive: true });
    writeFileSync(resourcesManifestPath(root), `${JSON.stringify(card("r1"))}\n{}\n`);

    expect(() => getAll(root)).toThrow(/line 2/);
  });
});
