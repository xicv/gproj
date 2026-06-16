import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PlannerBackend, PlannerAsk } from "./planner.js";
import { filePath } from "../format/paths.js";

type FetchResponse = { ok: boolean; json: () => Promise<any>; text?: () => Promise<string> };
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<FetchResponse>;
export interface OpenAIOpts { apiKey: string; root: string; baseUrl?: string; model?: string; fetchFn?: FetchLike; }

interface BackendState { conversations: Record<string, string>; }

function readBackendState(root: string): BackendState {
  const p = filePath(root, "backend.json");
  if (!existsSync(p)) return { conversations: {} };
  const raw = JSON.parse(readFileSync(p, "utf8")) as { conversations?: Record<string, string>; conversationId?: string };
  if (raw.conversations) return { conversations: raw.conversations };
  if (raw.conversationId) return { conversations: { default: raw.conversationId } };
  return { conversations: {} };
}

function readConvId(root: string, phaseKey: string): string | null {
  return readBackendState(root).conversations[phaseKey] ?? null;
}

function writeConvId(root: string, phaseKey: string, conversationId: string): void {
  const p = filePath(root, "backend.json");
  mkdirSync(dirname(p), { recursive: true });
  const state = readBackendState(root);
  writeFileSync(p, JSON.stringify({ conversations: { ...state.conversations, [phaseKey]: conversationId } }, null, 2));
}

async function errorText(r: FetchResponse): Promise<string> {
  try {
    if (r.text) return await r.text();
  } catch {
    // Fall through to JSON best effort.
  }
  try {
    return JSON.stringify(await r.json());
  } catch {
    return "<unreadable response body>";
  }
}

export function makeOpenAIResponsesBackend(opts: OpenAIOpts): PlannerBackend {
  const base = opts.baseUrl ?? "https://api.openai.com/v1";
  const model = opts.model ?? "gpt-5.5";
  const fetchFn = opts.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` };
  return {
    name: "openai-responses",
    async ask(req: PlannerAsk): Promise<string> {
      const phaseKey = req.phaseKey ?? "default";
      let convId = readConvId(opts.root, phaseKey);
      if (!convId) {
        const r = await fetchFn(`${base}/conversations`, { method: "POST", headers, body: JSON.stringify({}) });
        if (!r.ok) throw new Error(`openai: failed to create conversation: ${await errorText(r)}`);
        convId = (await r.json()).id as string;
        writeConvId(opts.root, phaseKey, convId);
      }
      const r = await fetchFn(`${base}/responses`, {
        method: "POST", headers,
        body: JSON.stringify({ model, conversation: convId, input: `${req.instruction}\n\n# CONTEXT\n${req.pack}` }),
      });
      if (!r.ok) throw new Error(`openai: response failed: ${await errorText(r)}`);
      const j = await r.json();
      return (j.output_text as string) ?? JSON.stringify(j);
    },
  };
}
