import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderDoctor } from "../../src/commands/doctor.js";
import { runAdvance } from "../../src/commands/advance.js";
import { runInit } from "../../src/commands/init.js";
import { runPackage } from "../../src/commands/package.js";
import { filePath } from "../../src/format/paths.js";
import { writeMarkdown } from "../../src/format/store.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gproj-"));
});

describe("doctor", () => {
  it("reports phase, status, and latest verifier result after init and advance", async () => {
    runInit(root, "Build X");
    writeFileSync(filePath(root, "config.json"), JSON.stringify({ sandbox: { mode: "none" } }));
    await runAdvance(root, { plannerName: "stub", executorName: "stub", maxTokens: 4000 });

    const out = renderDoctor(root);

    expect(out).toContain("phase: 1");
    expect(out).toContain("status: deciding");
    expect(out).toMatch(/verifier: (PASS|FAIL|UNVERIFIED)/);
  });

  it("reports not initialized when no state exists", () => {
    expect(renderDoctor(root)).toMatch(/not initialized/i);
  });

  it("warns when the current GOAL differs from the packaged phase hash", async () => {
    runInit(root, "Build X");
    await runPackage(root, { plannerName: "stub", maxTokens: 4000 });
    writeMarkdown(root, "GOAL.md", "# Goal\n\nBuild Y\n\n## Constraints\n\n(define)\n\n## Acceptance\n\n(define)\n");

    expect(renderDoctor(root)).toContain("GOAL changed since phase 1 was packaged — run `gproj package` to re-plan.");
  });
});
