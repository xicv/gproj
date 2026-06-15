import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderDoctor } from "../../src/commands/doctor.js";
import { runAdvance } from "../../src/commands/advance.js";
import { runInit } from "../../src/commands/init.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gproj-"));
});

describe("doctor", () => {
  it("reports phase, status, and latest verifier result after init and advance", async () => {
    runInit(root, "Build X");
    await runAdvance(root, { plannerName: "stub", executorName: "stub", maxTokens: 4000 });

    const out = renderDoctor(root);

    expect(out).toContain("phase: 1");
    expect(out).toContain("status: deciding");
    expect(out).toMatch(/verifier: (PASS|FAIL)/);
  });

  it("reports not initialized when no state exists", () => {
    expect(renderDoctor(root)).toMatch(/not initialized/i);
  });
});
