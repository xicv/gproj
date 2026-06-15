import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeOpenAIResponsesBackend } from "../../src/backends/openaiResponses.js";
import { filePath } from "../../src/format/paths.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

describe("openai-responses planner", () => {
  it("creates a conversation on first call and reuses it on the second", async () => {
    const calls: string[] = [];
    const fakeFetch = async (url: string, init: { body: string }) => {
      calls.push(url);
      if (url.endsWith("/conversations")) return { ok: true, json: async () => ({ id: "conv_123" }) };
      return { ok: true, json: async () => ({ output_text: "PLAN BODY" }) };
    };
    const b = makeOpenAIResponsesBackend({ apiKey: "k", root, fetchFn: fakeFetch as never });
    const out1 = await b.ask({ pack: "ctx", instruction: "plan 1" });
    const out2 = await b.ask({ pack: "ctx", instruction: "plan 2" });
    expect(out1).toContain("PLAN BODY");
    expect(out2).toContain("PLAN BODY");
    expect(calls.filter((u) => u.endsWith("/conversations")).length).toBe(1); // conversation created once
    expect(existsSync(filePath(root, "backend.json"))).toBe(true);
    expect(JSON.parse(readFileSync(filePath(root, "backend.json"), "utf8")).conversationId).toBe("conv_123");
  });
});
