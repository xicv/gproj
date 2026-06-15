import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.js";
import { runAdvance } from "../../src/commands/advance.js";
import { readState, readMarkdown } from "../../src/format/store.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); runInit(root, "Build X"); });

describe("advance", () => {
  it("runs package→exec→review in one shot and stops at deciding", async () => {
    await runAdvance(root, { plannerName: "stub", executorName: "stub", maxTokens: 4000 });
    expect(readMarkdown(root, "phases/01.md")).toBeTruthy();
    expect(readState(root)?.status).toBe("deciding");
  });
});
