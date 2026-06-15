import { describe, it, expect } from "vitest";
import { makeOracleBrowserBackend } from "../../src/backends/oracleBrowser.js";

describe("oracle-browser planner", () => {
  it("passes the pack as context and returns the answer text", async () => {
    let captured = "";
    const fakeSpawn = async (args: { prompt: string; context: string }) => { captured = args.context; return "ANSWER: plan here"; };
    const b = makeOracleBrowserBackend(fakeSpawn);
    const out = await b.ask({ pack: "CTX BODY", instruction: "plan phase 1", mode: "plan" });
    expect(out).toContain("plan here");
    expect(captured).toContain("CTX BODY");
  });
});
