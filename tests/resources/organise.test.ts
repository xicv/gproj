import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resourcesManifestPath } from "../../src/format/paths.js";
import { getAll, add } from "../../src/resources/manifest.js";
import { importResource } from "../../src/resources/import.js";
import { organiseResources, scanResourceFiles } from "../../src/resources/organise.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

describe("resources organise", () => {
  it("discovers files while excluding generated and dependency directories", () => {
    writeFileSync(join(root, "note.md"), "note");
    for (const dir of [".gproj", ".git", "node_modules", "dist", "build"]) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, "ignored.md"), "ignored");
    }

    expect(scanResourceFiles(root).map((file) => file.sourcePath)).toEqual(["note.md"]);
  });

  it("dry-runs without writing the manifest or assets", () => {
    writeFileSync(join(root, "note.md"), "# Note\nbody\n");
    writeFileSync(join(root, "image.bin"), Buffer.from([1, 2, 3]));

    const result = organiseResources(root, ".", { dryRun: true, now: new Date("2026-06-17T00:00:00.000Z") });

    expect(result.imports.map((item) => item.path)).toEqual(["image.bin", "note.md"]);
    expect(existsSync(resourcesManifestPath(root))).toBe(false);
  });

  it("deduplicates identical same-run content into one manifest card", () => {
    writeFileSync(join(root, "a.txt"), "same\r\ncontent\n");
    writeFileSync(join(root, "b.txt"), "same\ncontent\n");

    const result = organiseResources(root, ".", { now: new Date("2026-06-17T00:00:00.000Z") });
    const cards = getAll(root);

    expect(result.imports).toHaveLength(1);
    expect(result.duplicates).toEqual([{ path: "b.txt", id: cards[0].id, preExisting: false }]);
    expect(cards).toHaveLength(1);
    expect(cards[0].sourcePaths).toEqual(["a.txt", "b.txt"]);
  });

  it("deletes only pre-existing duplicates when requested", () => {
    writeFileSync(join(root, "keep.txt"), "same\n");
    const existing = add(root, importResource(root, "keep.txt", new Date("2026-06-17T00:00:00.000Z")));
    writeFileSync(join(root, "duplicate.txt"), "same\n");
    writeFileSync(join(root, "new-a.txt"), "new\n");
    writeFileSync(join(root, "new-b.txt"), "new\n");

    const result = organiseResources(root, ".", { deleteDuplicates: true, now: new Date("2026-06-17T00:00:00.000Z") });

    expect(result.deleted).toEqual([{ path: "duplicate.txt", deleted: true }]);
    expect(existsSync(join(root, "duplicate.txt"))).toBe(false);
    expect(existsSync(join(root, "new-b.txt"))).toBe(true);
    expect(getAll(root).find((card) => card.id === existing.id)?.sourcePaths).toEqual(["duplicate.txt", "keep.txt"]);
  });

  it("skips duplicate deletion when the file changes before unlink", () => {
    writeFileSync(join(root, "keep.txt"), "same\n");
    add(root, importResource(root, "keep.txt", new Date("2026-06-17T00:00:00.000Z")));
    writeFileSync(join(root, "duplicate.txt"), "same\n");

    const result = organiseResources(root, ".", {
      deleteDuplicates: true,
      beforeDelete: (candidate) => {
        if (candidate.sourcePath === "duplicate.txt") writeFileSync(join(root, "duplicate.txt"), "diff\n");
      },
    });

    expect(result.deleted).toEqual([{ path: "duplicate.txt", deleted: false, reason: "hash changed" }]);
    expect(existsSync(join(root, "duplicate.txt"))).toBe(true);
  });
});
