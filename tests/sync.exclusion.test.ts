import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveIncludedFiles } from "../src/commands/sync.js";
import { resourcesManifestPath, resourcesSharedManifestPath } from "../src/format/paths.js";
import type { ResourceCard } from "../src/format/schema.js";
import { writeAll } from "../src/resources/manifest.js";

describe("sync resource exclusion", () => {
  it("exports only shared resource cards and excludes pending/bookmark/local state", () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-"));
    mkdirSync(join(root, ".gproj", "resources", "pending"), { recursive: true });
    const local: ResourceCard = {
      id: "local",
      type: "sop",
      title: "Local SOP",
      category: "sop",
      tags: [],
      timestamp: "2026-06-18T00:00:00.000Z",
      body: "local secret",
      visibility: "local",
    };
    const shared: ResourceCard = {
      id: "shared",
      type: "sop",
      title: "Shared SOP",
      category: "sop",
      tags: [],
      timestamp: "2026-06-18T00:00:00.000Z",
      body: "shared body",
      visibility: "shared",
    };
    writeAll(root, [local, shared]);
    writeFileSync(join(root, ".gproj", "resources", "pending", "capture.json"), "{\"secret\":\"no\"}\n");
    writeFileSync(join(root, ".gproj", "resources", ".capture-bookmark.json"), "{}\n");
    writeFileSync(join(root, ".gproj", "resources", "sop.md"), "local bundle copy\n");
    writeFileSync(join(root, ".gproj", ".g.capture.log"), "failure\n");
    writeFileSync(join(root, ".gproj", "GOAL.md"), "goal\n");

    const files = resolveIncludedFiles(root, [".gproj/**"]);

    expect(files).toContain(".gproj/GOAL.md");
    expect(files).toContain(".gproj/resources.shared.ndjson");
    expect(files).not.toContain(".gproj/resources.ndjson");
    expect(files.some((file) => file.startsWith(".gproj/resources/"))).toBe(false);
    expect(files).not.toContain(".gproj/.g.capture.log");
    expect(readFileSync(resourcesManifestPath(root), "utf8")).toContain("local");
    const projection = readFileSync(resourcesSharedManifestPath(root), "utf8");
    expect(projection).toContain("shared");
    expect(projection).not.toContain("local");
    expect(projection).not.toContain("local secret");
  });
});
