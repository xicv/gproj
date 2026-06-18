import { describe, expect, it, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSchemaSource } from "../../src/resources/schemaSource.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

describe("schemaSource resolver", () => {
  it("resolves valid pointers and classifies unresolved pointers", () => {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "x.ts"), "export class Real {}\n");

    expect(resolveSchemaSource(root, "src/x.ts:Real")).toMatchObject({
      pointer: "src/x.ts:Real",
      path: "src/x.ts",
      symbol: "Real",
      status: "resolved",
      matches: [{ path: "src/x.ts", line: 1, text: "export class Real {}" }],
    });
    expect(resolveSchemaSource(root, "src/missing.ts:Real").status).toBe("missing-file");
    expect(resolveSchemaSource(root, "src/x.ts:Nope").status).toBe("missing-symbol");
    expect(resolveSchemaSource(root, "context").status).toBe("invalid");
  });

  it("returns stable results across repeated resolution calls", () => {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "x.ts"), "export function Real() {}\n");

    const first = resolveSchemaSource(root, "src/x.ts:Real");
    const second = resolveSchemaSource(root, "src/x.ts:Real");

    expect(second).toEqual(first);
  });
});
