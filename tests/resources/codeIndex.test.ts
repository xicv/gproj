import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCodeIndex } from "../../src/resources/codeIndex.js";

describe("code index", () => {
  it("finds exported symbols and endpoints while skipping dependency directories", () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-code-"));
    mkdirSync(join(root, "api"), { recursive: true });
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(root, "api", "routes.ts"), [
      "export class Foo {}",
      "export function bar() {}",
      "export const Baz = 1;",
      "export { Foo as PublicFoo, Baz }",
      "const route = 'GET /api/x';",
      "router.post('/api/y', handler);",
    ].join("\n"));
    writeFileSync(join(root, "node_modules", "pkg", "ignored.ts"), "export class Ignored {}\nGET /ignored\n");

    const index = buildCodeIndex(root);

    expect(index.symbols.get("Foo")).toEqual({ path: "api/routes.ts", line: 1 });
    expect(index.symbols.get("bar")).toEqual({ path: "api/routes.ts", line: 2 });
    expect(index.symbols.get("Baz")).toEqual({ path: "api/routes.ts", line: 3 });
    expect(index.symbols.has("Ignored")).toBe(false);
    expect(index.endpoints).toEqual([
      { label: "GET /api/x", path: "/api/x", line: 5 },
      { label: "POST /api/y", path: "/api/y", line: 6 },
    ]);
  });
});
