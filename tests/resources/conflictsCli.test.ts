import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resourcesConflictsPath } from "../../src/format/paths.js";
import { type ResourceCard } from "../../src/format/schema.js";
import { getAll, writeAll } from "../../src/resources/manifest.js";
import { isResourcesMutation, runResources } from "../../src/commands/resources.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gproj-cli-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "widget.ts"), "export class Widget {}\n");
});

function card(overrides: Partial<ResourceCard> = {}): ResourceCard {
  return {
    id: "r1",
    type: "text",
    title: "Doc card",
    category: "docs",
    tags: [],
    timestamp: "2026-06-19T00:00:00.000Z",
    body: "Widget does things",
    ...overrides,
  };
}

const codeRoot = ["--code-root", "src"];

describe("resources conflicts/resolve mutation classification", () => {
  it("classifies resolve as a mutation and conflicts as read-only", () => {
    expect(isResourcesMutation(["resolve", "r1", "--prefer", "code"])).toBe(true);
    expect(isResourcesMutation(["conflicts"])).toBe(false);
  });
});

describe("resources conflicts command", () => {
  it("writes a report and counts unresolved conflicts", async () => {
    writeAll(root, [card()]);
    const out = await runResources(root, ["conflicts", ...codeRoot]);
    expect(out).toContain("1 unresolved, 0 resolved");
    expect(existsSync(resourcesConflictsPath(root))).toBe(true);
    const report = readFileSync(resourcesConflictsPath(root), "utf8");
    expect(report).toContain("## r1 — Doc card");
    expect(report).toContain("unconfirmed symbols: Widget");
  });
});

describe("resources resolve --prefer doc (honored)", () => {
  it("suppresses re-flagging and makes ground skip the card", async () => {
    writeAll(root, [card()]);
    const resolved = await runResources(root, ["resolve", "r1", "--prefer", "doc", ...codeRoot]);
    expect(resolved).toContain("resolved: r1 --prefer doc");

    // ground must NOT add Widget grounding to a doc-preferred card.
    await runResources(root, ["ground", ...codeRoot]);
    expect(getAll(root)[0].owns).toBeUndefined();

    // conflicts now reports it as resolved, not unresolved.
    const out = await runResources(root, ["conflicts", ...codeRoot]);
    expect(out).toContain("0 unresolved, 1 resolved");
  });
});

describe("resources resolve --prefer code (applied)", () => {
  it("applies code grounding to the card and clears the conflict", async () => {
    writeAll(root, [card()]);
    const resolved = await runResources(root, ["resolve", "r1", "--prefer", "code", ...codeRoot]);
    expect(resolved).toContain("resolved: r1 --prefer code");

    const updated = getAll(root)[0];
    expect(updated.owns?.symbols).toEqual(["Widget"]);
    expect(updated.schemaSource).toEqual(["src/widget.ts:Widget"]);

    const out = await runResources(root, ["conflicts", ...codeRoot]);
    expect(out).toContain("0 unresolved, 0 resolved");
  });

  it("reports when an id has no conflict", async () => {
    writeAll(root, [card({ body: "plain prose, no symbols" })]);
    const out = await runResources(root, ["resolve", "r1", "--prefer", "code", ...codeRoot]);
    expect(out).toBe("resource has no conflict: r1");
  });
});

describe("resources ground without resolution", () => {
  it("still grounds normally when no resolution exists", async () => {
    writeAll(root, [card()]);
    await runResources(root, ["ground", ...codeRoot]);
    expect(getAll(root)[0].owns?.symbols).toEqual(["Widget"]);
  });
});
