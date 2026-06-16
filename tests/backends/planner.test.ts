import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlannerBackend } from "../../src/backends/planner.js";
import { filePath } from "../../src/format/paths.js";

const originalOpenAIKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAIKey;
});

describe("planner registry", () => {
  it("returns a stub backend by name", async () => {
    const b = getPlannerBackend("stub");
    const out = await b.ask({ pack: "ctx", instruction: "plan phase 1" });
    expect(out).toContain("plan phase 1");
  });
  it("throws on unknown backend", () => {
    expect(() => getPlannerBackend("nope")).toThrow(/unknown planner/i);
  });

  it("passes configured plannerModel to openai-responses", async () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-"));
    mkdirSync(filePath(root, "."), { recursive: true });
    writeFileSync(filePath(root, "config.json"), JSON.stringify({ plannerModel: "gpt-5.5-pro" }));
    process.env.OPENAI_API_KEY = "k";
    const responseBodies: unknown[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      if (url.endsWith("/conversations")) return { ok: true, json: async () => ({ id: "conv_123" }) };
      responseBodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ output_text: "PLAN BODY" }) };
    });

    const b = getPlannerBackend("openai-responses", root);
    await b.ask({ pack: "ctx", instruction: "plan" });

    expect(responseBodies.map((b) => (b as { model: string }).model)).toEqual(["gpt-5.5-pro"]);
  });
});
