import { describe, it, expect } from "vitest";
import { makeClaudeCodeTarget } from "../../src/backends/claudeCode.js";

describe("claude-code executor", () => {
  it("parses a claude -p json result envelope", async () => {
    const fakeSpawn = async () => ({ stdout: JSON.stringify({ result: "CHANGED: x.ts\nTESTS: pass\nDIFFSTAT: +1 -0" }), code: 0 });
    const target = makeClaudeCodeTarget(fakeSpawn);
    const r = await target.run({ root: "/tmp", phase: 1, prompt: "do it" });
    expect(r.changedFiles).toEqual(["x.ts"]);
    expect(r.testsPassed).toBe(true);
  });
});
