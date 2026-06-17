import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resourcesBundleDir } from "../../src/format/paths.js";
import { type ResourceCard } from "../../src/format/schema.js";
import { renderOkfBundle } from "../../src/resources/okf.js";

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
});
