import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeOpenAIResponsesBackend } from "../../src/backends/openaiResponses.js";
import { filePath } from "../../src/format/paths.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

describe("openai-responses planner", () => {
  it("creates and reuses conversations by phase key", async () => {
    const calls: string[] = [];
    const responseBodies: unknown[] = [];
    let nextConv = 1;
    const fakeFetch = async (url: string, init: { body: string }) => {
      calls.push(url);
      if (url.endsWith("/conversations")) return { ok: true, json: async () => ({ id: `conv_${nextConv++}` }) };
      responseBodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ output_text: "PLAN BODY" }) };
    };
    const b = makeOpenAIResponsesBackend({ apiKey: "k", root, fetchFn: fakeFetch as never });
    const out1 = await b.ask({ pack: "ctx", instruction: "plan 1", phaseKey: "p1" });
    const out2 = await b.ask({ pack: "ctx", instruction: "plan 2", phaseKey: "p1" });
    const out3 = await b.ask({ pack: "ctx", instruction: "plan 3", phaseKey: "p2" });
    expect(out1).toContain("PLAN BODY");
    expect(out2).toContain("PLAN BODY");
    expect(out3).toContain("PLAN BODY");
    expect(calls.filter((u) => u.endsWith("/conversations")).length).toBe(2);
    expect(responseBodies.map((b) => (b as { conversation: string }).conversation)).toEqual(["conv_1", "conv_1", "conv_2"]);
    expect(existsSync(filePath(root, "backend.json"))).toBe(true);
    expect(JSON.parse(readFileSync(filePath(root, "backend.json"), "utf8")).conversations).toEqual({ p1: "conv_1", p2: "conv_2" });
  });

  it("reads old conversationId shape as the default conversation", async () => {
    mkdirSync(filePath(root, "."), { recursive: true });
    writeFileSync(filePath(root, "backend.json"), JSON.stringify({ conversationId: "conv_old" }));
    const responseBodies: unknown[] = [];
    const fakeFetch = async (url: string, init: { body: string }) => {
      if (url.endsWith("/conversations")) throw new Error("should not create a conversation");
      responseBodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ output_text: "PLAN BODY" }) };
    };

    const b = makeOpenAIResponsesBackend({ apiKey: "k", root, fetchFn: fakeFetch as never });
    await b.ask({ pack: "ctx", instruction: "plan" });

    expect(responseBodies.map((b) => (b as { conversation: string }).conversation)).toEqual(["conv_old"]);
  });

  it("includes response body text in non-ok errors", async () => {
    const fakeFetch = async () => ({
      ok: false,
      text: async () => "quota exhausted",
      json: async () => ({ error: "quota exhausted" }),
    });

    const b = makeOpenAIResponsesBackend({ apiKey: "k", root, fetchFn: fakeFetch as never });

    await expect(b.ask({ pack: "ctx", instruction: "plan" })).rejects.toThrow("quota exhausted");
  });

  it("uses gpt-5.5 as the default model", async () => {
    const responseBodies: unknown[] = [];
    const fakeFetch = async (url: string, init: { body: string }) => {
      if (url.endsWith("/conversations")) return { ok: true, json: async () => ({ id: "conv_123" }) };
      responseBodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ output_text: "PLAN BODY" }) };
    };

    const b = makeOpenAIResponsesBackend({ apiKey: "k", root, fetchFn: fakeFetch as never });
    await b.ask({ pack: "ctx", instruction: "plan" });

    expect(responseBodies.map((b) => (b as { model: string }).model)).toEqual(["gpt-5.5"]);
  });
});
