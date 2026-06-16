import { makeOracleBrowserBackend } from "./oracleBrowser.js";
import { makeOpenAIResponsesBackend } from "./openaiResponses.js";
import { loadConfig } from "../config/projectConfig.js";

export interface PlannerAsk { pack: string; instruction: string; mode?: string; phaseKey?: string; }
export interface PlannerBackend { name: string; ask(req: PlannerAsk): Promise<string>; }

const stub: PlannerBackend = { name: "stub", async ask(req) { return `STUB PLAN\n${req.instruction}\n---\n${req.pack}`; } };

export function getPlannerBackend(name: string, root = process.cwd()): PlannerBackend {
  if (name === "openai-responses") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("openai-responses requires OPENAI_API_KEY");
    return makeOpenAIResponsesBackend({ apiKey, root, model: loadConfig(root).plannerModel });
  }
  const registry: Record<string, PlannerBackend> = { stub, "oracle-browser": makeOracleBrowserBackend() };
  const b = registry[name];
  if (!b) throw new Error(`unknown planner backend: ${name}`);
  return b;
}
