import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResourceCard } from "../../src/format/schema.js";
import type { CodeIndex } from "../../src/resources/codeIndex.js";
import { applyCodeSide, conflictForCard, detectConflicts, renderConflictsReport } from "../../src/resources/conflicts.js";
import { appendResolution } from "../../src/resources/resolutions.js";
import { writeAll } from "../../src/resources/manifest.js";

function card(overrides: Partial<ResourceCard> = {}): ResourceCard {
  return {
    id: "r1",
    type: "text",
    title: "Resource",
    category: "docs",
    tags: [],
    timestamp: "2026-06-19T00:00:00.000Z",
    ...overrides,
  };
}

function emptyIndex(): CodeIndex {
  return { symbols: new Map(), endpoints: [] };
}

describe("conflictForCard", () => {
  it("returns null when doc and code agree (no grounding, no schemaSource)", () => {
    expect(conflictForCard("/tmp/none", card({ body: "plain prose" }), emptyIndex(), "/tmp/none")).toBeNull();
  });

  it("flags dangling schemaSource pointers that no longer resolve", () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-cf-"));
    const c = card({ schemaSource: ["src/gone.ts:Ghost"], body: "no symbols here" });
    const conflict = conflictForCard(root, c, emptyIndex(), root);
    expect(conflict?.kinds).toContain("dangling");
    expect(conflict?.dangling).toEqual([{ pointer: "src/gone.ts:Ghost", status: "missing-file" }]);
  });

  it("flags unconfirmed code groundings the card does not yet claim", () => {
    const index: CodeIndex = { symbols: new Map([["Widget", { path: "src/widget.ts", line: 1 }]]), endpoints: [] };
    const conflict = conflictForCard("/tmp/none", card({ body: "Widget does things" }), index, "/tmp/none");
    expect(conflict?.kinds).toEqual(["unconfirmed"]);
    expect(conflict?.unconfirmed.symbols).toEqual(["Widget"]);
    expect(conflict?.unconfirmed.schemaSource).toEqual(["src/widget.ts:Widget"]);
  });

  it("rebases code-side schemaSource to root-relative when a code-root subdir is used", () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-rb-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "widget.ts"), "export class Widget {}\n");
    // index built with codeRoot=root/src yields path "widget.ts"; rebased to "src/widget.ts".
    const index: CodeIndex = { symbols: new Map([["Widget", { path: "widget.ts", line: 1 }]]), endpoints: [] };
    const conflict = conflictForCard(root, card({ body: "Widget" }), index, join(root, "src"));
    expect(conflict?.unconfirmed.schemaSource).toEqual(["src/widget.ts:Widget"]);
  });

  it("flags a mismatch when doc and code place the same symbol at different paths", () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-mm-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "real.ts"), "export class Widget {}\n");
    const index: CodeIndex = { symbols: new Map([["Widget", { path: "src/real.ts", line: 1 }]]), endpoints: [] };
    const c = card({ body: "Widget", owns: { symbols: ["Widget"], endpoints: [], configKeys: [] }, schemaSource: ["src/old.ts:Widget"] });
    const conflict = conflictForCard(root, c, index, root);
    expect(conflict?.kinds).toContain("mismatch");
    expect(conflict?.mismatch).toEqual([{ symbol: "Widget", docPath: "src/old.ts", codePath: "src/real.ts" }]);
    // src/old.ts doesn't exist → also dangling
    expect(conflict?.kinds).toContain("dangling");
  });

  it("produces a stable fingerprint for the same conflict content", () => {
    const index: CodeIndex = { symbols: new Map([["Widget", { path: "src/widget.ts", line: 1 }]]), endpoints: [] };
    const a = conflictForCard("/tmp/none", card({ body: "Widget" }), index, "/tmp/none");
    const b = conflictForCard("/tmp/none", card({ body: "Widget" }), index, "/tmp/none");
    expect(a?.fingerprint).toBe(b?.fingerprint);
    expect(a?.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("applyCodeSide", () => {
  it("adds unconfirmed additions, drops dangling-only, rewrites mismatched paths", () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-ac-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "real.ts"), "export class Widget {}\n");
    const index: CodeIndex = { symbols: new Map([["Widget", { path: "src/real.ts", line: 1 }]]), endpoints: [] };
    const c = card({
      body: "Widget",
      owns: { symbols: [], endpoints: [], configKeys: [] },
      schemaSource: ["src/old.ts:Widget", "src/dead.ts:Gone"],
    });
    const conflict = conflictForCard(root, c, index, root)!;
    const applied = applyCodeSide(c, conflict);
    expect(applied.owns?.symbols).toEqual(["Widget"]);
    // src/old.ts:Widget rewritten to code path; src/dead.ts:Gone dropped as dangling.
    expect(applied.schemaSource).toEqual(["src/real.ts:Widget"]);
  });
});

describe("detectConflicts", () => {
  it("excludes cards whose current fingerprint has a resolution and counts them resolved", () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-dc-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "widget.ts"), "export class Widget {}\n");
    writeAll(root, [card({ body: "Widget does things" })]);
    const before = detectConflicts(root, join(root, "src"));
    expect(before.conflicts.length).toBe(1);
    expect(before.resolved).toBe(0);
    const fp = before.conflicts[0].fingerprint;
    appendResolution(root, { id: "r1", prefer: "doc", fingerprint: fp, resolvedAt: "2026-06-19T00:00:00.000Z" });
    const after = detectConflicts(root, join(root, "src"));
    expect(after.conflicts.length).toBe(0);
    expect(after.resolved).toBe(1);
  });

  it("renders a markdown report", () => {
    const result = { codeRoot: "src", index: emptyIndex(), conflicts: [], resolved: 2 };
    const report = renderConflictsReport(result);
    expect(report).toContain("# Resource conflicts");
    expect(report).toContain("resolved (honored): 2");
    expect(report).toContain("No unresolved conflicts.");
  });
});
