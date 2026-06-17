import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resourcesBundleDir, resourcesManifestPath } from "../../src/format/paths.js";
import { type ResourceCard } from "../../src/format/schema.js";
import { diagnoseResources, renderResourceDoctor } from "../../src/resources/doctor.js";
import { renderOkfBundle } from "../../src/resources/okf.js";
import { writeAll } from "../../src/resources/manifest.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

function card(id: string): ResourceCard {
  return {
    id,
    type: "text",
    title: id,
    category: "docs",
    tags: [],
    timestamp: "2026-06-17T00:00:00.000Z",
    sourcePaths: [`${id}.md`],
  };
}

describe("resources doctor", () => {
  it("reports an ok result for an empty resource system", () => {
    expect(renderResourceDoctor(root)).toBe("resources doctor: ok");
  });

  it("detects duplicate ids, dangling links, missing assets, and text hash drift", () => {
    mkdirSync(join(root, ".gproj"), { recursive: true });
    const cards: ResourceCard[] = [
      { ...card("r1"), links: [{ rel: "references", toId: "missing" }], body: "changed", contentHash: "0".repeat(64) },
      { ...card("r1"), title: "duplicate" },
      {
        id: "asset",
        type: "binary",
        title: "Asset",
        category: "assets",
        tags: [],
        timestamp: "2026-06-17T00:00:00.000Z",
        resource: "_assets/missing.bin",
        contentHash: "1".repeat(64),
      },
    ];
    writeFileSync(resourcesManifestPath(root), cards.map((item) => JSON.stringify(item)).join("\n") + "\n");

    const messages = diagnoseResources(root).map((diagnostic) => diagnostic.message);

    expect(messages).toContain("duplicate resource id: r1");
    expect(messages).toContain("dangling link: r1 references -> missing");
    expect(messages).toContain("missing asset for asset: _assets/missing.bin");
    expect(messages).toContain("contentHash drift for text r1");
  });

  it("detects asset hash drift and OKF bundle drift", () => {
    const asset: ResourceCard = {
      id: "asset",
      type: "binary",
      title: "Asset",
      category: "assets",
      tags: [],
      timestamp: "2026-06-17T00:00:00.000Z",
      resource: "_assets/asset.bin",
      contentHash: "1".repeat(64),
      sourcePaths: ["asset.bin"],
    };
    writeAll(root, [asset]);
    mkdirSync(join(resourcesBundleDir(root), "_assets"), { recursive: true });
    writeFileSync(join(resourcesBundleDir(root), "_assets", "asset.bin"), Buffer.from([1, 2, 3]));
    renderOkfBundle(root, [asset]);
    writeFileSync(join(resourcesBundleDir(root), "assets", "asset.md"), `${readFileSync(join(resourcesBundleDir(root), "assets", "asset.md"), "utf8")}\nmanual edit\n`);

    const messages = diagnoseResources(root).map((diagnostic) => diagnostic.message);

    expect(messages).toContain("contentHash drift for asset asset: _assets/asset.bin");
    expect(messages).toContain("OKF bundle drift: content mismatch assets/asset.md");
  });
});
