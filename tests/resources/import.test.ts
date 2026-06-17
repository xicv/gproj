import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resourcesBundleDir } from "../../src/format/paths.js";
import { importResource } from "../../src/resources/import.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

describe("resource import", () => {
  it("imports markdown as body and excerpt", () => {
    const path = join(root, "note.md");
    writeFileSync(path, "# Note\r\n\nbody\n");

    const card = importResource(root, "note.md", new Date("2026-06-17T00:00:00.000Z"));

    expect(card.type).toBe("text");
    expect(card.body).toBe("# Note\n\nbody\n");
    expect(card.excerpt).toBe("# Note\n\nbody");
    expect(card.sourcePaths).toEqual(["note.md"]);
    expect(card.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("copies binary assets into content-addressed storage", () => {
    writeFileSync(join(root, "image.bin"), Buffer.from([0, 1, 2, 3]));

    const card = importResource(root, "image.bin", new Date("2026-06-17T00:00:00.000Z"));

    expect(card.type).toBe("binary");
    expect(card.resource).toMatch(/^_assets\/image-[a-f0-9]{12}-[a-f0-9]{64}\.bin$/);
    expect(existsSync(join(resourcesBundleDir(root), card.resource ?? ""))).toBe(true);
    expect(readFileSync(join(resourcesBundleDir(root), card.resource ?? ""))).toEqual(Buffer.from([0, 1, 2, 3]));
  });

  it("hashes identical normalized text content consistently", () => {
    writeFileSync(join(root, "a.txt"), "same\r\ncontent\n");
    writeFileSync(join(root, "b.txt"), "same\ncontent\n");

    const a = importResource(root, "a.txt", new Date("2026-06-17T00:00:00.000Z"));
    const b = importResource(root, "b.txt", new Date("2026-06-17T00:00:00.000Z"));

    expect(a.contentHash).toBe(b.contentHash);
  });
});
