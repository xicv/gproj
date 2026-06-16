import { describe, it, expect } from "vitest";
import { makeOracleBrowserBackend, parseOracleAnswer } from "../../src/backends/oracleBrowser.js";

describe("oracle-browser planner", () => {
  it("passes the pack as context and returns the answer text", async () => {
    let captured = "";
    const fakeSpawn = async (args: { prompt: string; context: string }) => { captured = args.context; return "ANSWER: plan here"; };
    const b = makeOracleBrowserBackend(fakeSpawn);
    const out = await b.ask({ pack: "CTX BODY", instruction: "plan phase 1", mode: "plan" });
    expect(out).toContain("plan here");
    expect(captured).toContain("CTX BODY");
  });

  it("parses the real multi-line oracle output format", () => {
    const stdout = [
      "oracle 0.14.0 - browser planner",
      "Session: abc123",
      "Model: gpt-5.5-pro[browser]",
      "Answer:",
      "PONG",
      "",
      "38.6s · gpt-5.5-pro[browser] · ↑20 ↓1 ↻0 Δ21",
    ].join("\n");

    expect(parseOracleAnswer(stdout)).toBe("PONG");
  });

  it("preserves a multi-line answer body", () => {
    const stdout = [
      "noise",
      "Answer:",
      "First line",
      "Second line",
      "",
      "Third line",
      "",
      "1.2s · gpt-5.5-pro[browser] · ↑3 ↓1 ↻0 Δ4",
    ].join("\n");

    expect(parseOracleAnswer(stdout)).toBe("First line\nSecond line\n\nThird line");
  });

  it("falls back to the full trimmed stdout without an Answer marker", () => {
    expect(parseOracleAnswer("  no answer marker\nstill output  \n")).toBe("no answer marker\nstill output");
  });

  it("strips the trailing oracle footer line", () => {
    const stdout = "\nAnswer:\nfinal answer\n\n38.6s · gpt-5.5-pro[browser] · ↑20 ↓1 ↻0 Δ21";

    expect(parseOracleAnswer(stdout)).toBe("final answer");
  });
});
