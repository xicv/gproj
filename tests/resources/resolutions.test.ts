import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resourcesResolutionsPath } from "../../src/format/paths.js";
import { appendResolution, preferenceFor, readResolutions } from "../../src/resources/resolutions.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-res-")); });

describe("conflict resolutions store", () => {
  it("returns [] when no resolutions file exists", () => {
    expect(readResolutions(root)).toEqual([]);
  });

  it("appends and reads back a resolution", () => {
    appendResolution(root, { id: "r1", prefer: "code", fingerprint: "abc123", resolvedAt: "2026-06-19T00:00:00.000Z" });
    expect(readResolutions(root)).toEqual([
      { id: "r1", prefer: "code", fingerprint: "abc123", resolvedAt: "2026-06-19T00:00:00.000Z" },
    ]);
  });

  it("preferenceFor matches on id AND fingerprint, last write wins", () => {
    appendResolution(root, { id: "r1", prefer: "code", fingerprint: "fp1", resolvedAt: "2026-06-19T00:00:00.000Z" });
    appendResolution(root, { id: "r1", prefer: "doc", fingerprint: "fp1", resolvedAt: "2026-06-19T01:00:00.000Z" });
    const resolutions = readResolutions(root);
    expect(preferenceFor(resolutions, "r1", "fp1")).toBe("doc");
    // Different fingerprint (code moved on) → not resolved, re-surfaces as new.
    expect(preferenceFor(resolutions, "r1", "fp2")).toBeUndefined();
    expect(preferenceFor(resolutions, "r2", "fp1")).toBeUndefined();
  });

  it("throws on malformed JSON lines", () => {
    const path = resourcesResolutionsPath(root);
    mkdirSync(join(root, ".gproj", "resources"), { recursive: true });
    writeFileSync(path, "{not json}\n");
    expect(() => readResolutions(root)).toThrow(/invalid JSON/);
  });

  it("throws on schema-invalid resolution lines", () => {
    const path = resourcesResolutionsPath(root);
    mkdirSync(join(root, ".gproj", "resources"), { recursive: true });
    writeFileSync(path, JSON.stringify({ id: "r1", prefer: "sideways", fingerprint: "x", resolvedAt: "t" }) + "\n");
    expect(() => readResolutions(root)).toThrow(/invalid resolution/);
  });
});
