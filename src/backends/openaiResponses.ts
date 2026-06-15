import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PlannerBackend, PlannerAsk } from "./planner.js";
import { filePath } from "../format/paths.js";

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; json: () => Promise<any> }>;
export interface OpenAIOpts { apiKey: string; root: string; baseUrl?: string; model?: string; fetchFn?: FetchLike; }

function readConvId(root: string): string | null {
  const p = filePath(root, "backend.json");
  if (!existsSync(p)) return null;
  return (JSON.parse(readFileSync(p, "utf8")).conversationId as string) ?? null;
}
function writeConvId(root: string, conversationId: string): void {
  const p = filePath(root, "backend.json");
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ conversationId }, null, 2));
}

export function makeOpenAIResponsesBackend(opts: OpenAIOpts): PlannerBackend {
  const base = opts.baseUrl ?? "https://api.openai.com/v1";
  const model = opts.model ?? "gpt-5.5-pro";
  const fetchFn = opts.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` };
  return {
    name: "openai-responses",
    async ask(req: PlannerAsk): Promise<string> {
      let convId = readConvId(opts.root);
      if (!convId) {
        const r = await fetchFn(`${base}/conversations`, { method: "POST", headers, body: JSON.stringify({}) });
        if (!r.ok) throw new Error("openai: failed to create conversation");
        convId = (await r.json()).id as string;
        writeConvId(opts.root, convId);
      }
      const r = await fetchFn(`${base}/responses`, {
        method: "POST", headers,
        body: JSON.stringify({ model, conversation: convId, input: `${req.instruction}\n\n# CONTEXT\n${req.pack}` }),
      });
      if (!r.ok) throw new Error("openai: response failed");
      const j = await r.json();
      return (j.output_text as string) ?? JSON.stringify(j);
    },
  };
}
