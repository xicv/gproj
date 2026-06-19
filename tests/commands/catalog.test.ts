import { describe, expect, it } from "vitest";
import { catalogEntries, rankCatalogEntries, renderCatalogText } from "../../src/catalog.js";
import { generateCodexAgentsBlock } from "../../src/agent/agents.js";
import { generateClaudeSkillMarkdown } from "../../src/agent/skill.js";
import { runCatalog } from "../../src/commands/catalog.js";

describe("catalog command", () => {
  it("renders JSON as the registry schema 1:1", () => {
    expect(JSON.parse(runCatalog(["--json"]))).toEqual(catalogEntries);
  });

  it("renders grouped text output", () => {
    const output = renderCatalogText(catalogEntries);

    expect(output).toContain("project:");
    expect(output).toContain("workflow:");
    expect(output).toContain("resources:");
    expect(output).toContain("capture:");
    expect(output).toContain("agent:");
    expect(output).toContain("usage: gproj catalog [--json] [--intent <text>]");
    expect(output).toContain("usage: gproj resources enrich [--category <category>] [--limit <n>] [--batch-size <n>] [--code-root <path>] [--dry-run] [--reenrich] [--relink]");
    expect(output).toContain("usage: gproj resources ground [--code-root <path>]");
    expect(output).toContain("usage: gproj resources find [--limit <n>|--all] <query>");
    expect(output).toContain("usage: gproj resources eval <evalset.json> [--json]");
  });

  it("returns deterministic ranked intent matches", () => {
    const first = rankCatalogEntries("install capture hook").map((entry) => entry.name);
    const second = rankCatalogEntries("install capture hook").map((entry) => entry.name);

    expect(second).toEqual(first);
    expect(first[0]).toBe("resources capture install-hook");
    expect(first).toContain("resources capture");
  });

  it("falls back to the full text catalog when intent has no match", () => {
    const output = runCatalog(["--intent", "zzzz-not-a-real-intent"]);

    expect(output).toContain("No catalog entries matched intent");
    expect(output).toContain("gproj catalog");
    expect(output).toContain("resources capture install-hook");
  });

  it("keeps generated agent instructions pointer-only", () => {
    const outputs = [generateClaudeSkillMarkdown(), generateCodexAgentsBlock()];

    for (const output of outputs) {
      expect(output).toContain("gproj catalog");
      expect(output).toContain("gproj catalog --intent");
      expect(output).toContain("gproj <cmd> --help");
      expect(output).not.toContain("gproj init");
      expect(output).not.toContain("gproj advance");
      expect(output).not.toContain("gproj decide");
    }
  });
});
