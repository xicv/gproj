import { describe, expect, it } from "vitest";
import type { ResourceCard } from "../../src/format/schema.js";
import type { CodeIndex } from "../../src/resources/codeIndex.js";
import { groundCard } from "../../src/resources/codeGround.js";

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

describe("code grounding", () => {
  it("grounds whole-word symbols, schema sources, and endpoint labels", () => {
    const index: CodeIndex = {
      symbols: new Map([["Foo", { path: "src/foo.ts", line: 1 }]]),
      endpoints: [{ label: "GET /api/x", path: "/api/x", line: 2 }],
    };

    expect(groundCard(card({ body: "Foo handles GET /api/x." }), index)).toEqual({
      symbols: ["Foo"],
      schemaSource: ["src/foo.ts:Foo"],
      endpoints: ["GET /api/x"],
    });
  });

  it("does not ground short or noisy lowercase symbol names", () => {
    const index: CodeIndex = {
      symbols: new Map([
        ["Foo", { path: "src/foo.ts", line: 1 }],
        ["data", { path: "src/data.ts", line: 1 }],
      ]),
      endpoints: [],
    };

    expect(groundCard(card({ body: "foo data" }), index)).toEqual({
      symbols: [],
      schemaSource: [],
      endpoints: [],
    });
  });
});
