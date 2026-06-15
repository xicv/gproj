import { describe, it, expect } from "vitest";
import { estimateTokens, pruneToBudget } from "../../src/assembler/budget.js";

describe("budget", () => {
  it("estimates ~1 token per 4 chars", () => {
    expect(estimateTokens("abcd".repeat(25))).toBe(25);
  });
  it("keeps high-priority sections, drops low ones over budget", () => {
    const sections = [
      { label: "goal", priority: 10, text: "x".repeat(40) },     // 10 tok
      { label: "issues", priority: 1, text: "y".repeat(400) },   // 100 tok
    ];
    const kept = pruneToBudget(sections, 20);
    expect(kept.map((s) => s.label)).toEqual(["goal"]);
  });
  it("always keeps mandatory sections even over budget", () => {
    const sections = [
      { label: "goal", priority: 100, mandatory: true, text: "g".repeat(4000) }, // 1000 tok, mandatory
      { label: "issues", priority: 1, text: "y".repeat(40) },
    ];
    const kept = pruneToBudget(sections, 10);
    expect(kept.map((s) => s.label)).toContain("goal");
  });
});
