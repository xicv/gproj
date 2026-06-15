import { describe, it, expect } from "vitest";
import { getExecutorTarget } from "../../src/backends/executor.js";

describe("executor registry", () => {
  it("returns a stub target by name", async () => {
    const t = getExecutorTarget("stub");
    const r = await t.run({ root: "/tmp", phase: 1, prompt: "do it" });
    expect(r.changedFiles).toBeInstanceOf(Array);
    expect(typeof r.testsPassed).toBe("boolean");
  });
  it("throws on unknown target", () => {
    expect(() => getExecutorTarget("nope")).toThrow(/unknown executor/i);
  });
});
