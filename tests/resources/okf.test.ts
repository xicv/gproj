import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resourcesBundleDir } from "../../src/format/paths.js";
import { type ResourceCard } from "../../src/format/schema.js";
import { renderOkfBundle, renderOkfFiles } from "../../src/resources/okf.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

describe("OKF resource projection", () => {
  it("generates root index, category index, and card markdown", () => {
    const card: ResourceCard = {
      id: "r1",
      type: "text",
      title: "Resource One",
      category: "docs",
      tags: ["alpha"],
      timestamp: "2026-06-17T00:00:00.000Z",
      body: "Body text",
    };

    renderOkfBundle(root, [card]);

    const bundle = resourcesBundleDir(root);
    expect(existsSync(join(bundle, "index.md"))).toBe(true);
    expect(existsSync(join(bundle, "docs", "index.md"))).toBe(true);
    expect(existsSync(join(bundle, "docs", "r1.md"))).toBe(true);
    expect(readFileSync(join(bundle, "index.md"), "utf8")).toContain("docs/r1.md");
    expect(readFileSync(join(bundle, "docs", "r1.md"), "utf8")).toContain("## Related");
  });

  it("renders typed links in frontmatter and related markdown deterministically", () => {
    const cards: ResourceCard[] = [
      {
        id: "r2",
        type: "text",
        title: "Target",
        category: "docs",
        tags: [],
        timestamp: "2026-06-17T00:00:00.000Z",
        body: "Target body",
      },
      {
        id: "r1",
        type: "text",
        title: "Source",
        category: "docs",
        tags: ["alpha"],
        timestamp: "2026-06-17T00:00:00.000Z",
        body: "Source body",
        links: [{ rel: "depends-on", toId: "r2" }],
      },
    ];

    const first = renderOkfFiles(cards);
    const second = renderOkfFiles([...cards].reverse());

    expect([...first.entries()]).toEqual([...second.entries()]);
    expect(first.get("docs/r1.md")).toContain("rel: \"depends-on\"");
    expect(first.get("docs/r1.md")).toContain("- depends-on: r2");
  });

  it("swaps stale card files out while preserving existing assets", () => {
    const bundle = resourcesBundleDir(root);
    mkdirSync(join(bundle, "_assets"), { recursive: true });
    writeFileSync(join(bundle, "_assets", "keep.bin"), Buffer.from([1]), { flag: "wx" });

    renderOkfBundle(root, [{
      id: "r1",
      type: "text",
      title: "Resource One",
      category: "docs",
      tags: [],
      timestamp: "2026-06-17T00:00:00.000Z",
      body: "Body text",
    }]);
    writeFileSync(join(bundle, "stale.md"), "stale");

    renderOkfBundle(root, []);

    expect(existsSync(join(bundle, "stale.md"))).toBe(false);
    expect(existsSync(join(bundle, "_assets", "keep.bin"))).toBe(true);
  });
});
