import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.js";
import { renderStatus } from "../../src/commands/status.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

describe("status", () => {
  it("reports phase, status, and next action", () => {
    runInit(root, "goal");
    const out = renderStatus(root);
    expect(out).toContain("phase 1");
    expect(out).toContain("init");
    expect(out.toLowerCase()).toContain("next");
  });
  it("reports uninitialized when no store", () => {
    expect(renderStatus(root)).toMatch(/not initialized/i);
  });
});
