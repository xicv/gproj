import { describe, it, expect } from "vitest";
import { getPlannerBackend } from "../../src/backends/planner.js";

describe("planner registry", () => {
  it("returns a stub backend by name", async () => {
    const b = getPlannerBackend("stub");
    const out = await b.ask({ pack: "ctx", instruction: "plan phase 1" });
    expect(out).toContain("plan phase 1");
  });
  it("throws on unknown backend", () => {
    expect(() => getPlannerBackend("nope")).toThrow(/unknown planner/i);
  });
});
