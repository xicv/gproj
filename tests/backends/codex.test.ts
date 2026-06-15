import { describe, it, expect } from "vitest";
import { makeCodexTarget } from "../../src/backends/codex.js";

describe("codex executor", () => {
  it("parses changed files and test result from executor output", async () => {
    const fakeSpawn = async () => ({ stdout: "CHANGED: src/a.ts\nCHANGED: src/b.ts\nTESTS: pass\nDIFFSTAT: +12 -3", code: 0 });
    const target = makeCodexTarget(fakeSpawn);
    const r = await target.run({ root: "/tmp", phase: 1, prompt: "do it" });
    expect(r.changedFiles).toEqual(["src/a.ts", "src/b.ts"]);
    expect(r.testsPassed).toBe(true);
    expect(r.diffStat).toBe("+12 -3");
  });
  it("marks tests failed and captures failures", async () => {
    const fakeSpawn = async () => ({ stdout: "TESTS: fail\nFAILURE: expected 1 got 2", code: 0 });
    const target = makeCodexTarget(fakeSpawn);
    const r = await target.run({ root: "/tmp", phase: 1, prompt: "x" });
    expect(r.testsPassed).toBe(false);
    expect(r.failures).toContain("expected 1 got 2");
  });
});
