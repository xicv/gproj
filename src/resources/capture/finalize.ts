import { z } from "zod";
import type { PlannerBackend } from "../../backends/planner.js";
import { ResourceCardSchema, type ResourceCard } from "../../format/schema.js";
import { getAll, writeAll } from "../manifest.js";
import { renderOkfBundle } from "../okf.js";
import { slugify } from "../import.js";
import { discardPendingCapture, readPendingCapture, type PendingCapture } from "./pending.js";
import { containsUnredactedSecret, redactText } from "./redact.js";

const PlannerSopSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  facts: z.array(z.string()).default([]),
  repro: z.array(z.string()).default([]),
  resolution: z.string().default(""),
  triggers: z.array(z.string()).default([]),
}).strict();

export type PlannerSop = z.infer<typeof PlannerSopSchema>;

export interface FinalizeOptions {
  planner: PlannerBackend;
  share?: boolean;
  decision?: "add" | "refine";
  refineId?: string;
  now?: Date;
}

export interface FinalizeResult {
  action: "added" | "refined";
  card: ResourceCard;
  pending: PendingCapture;
}

function extractJson(value: string): unknown {
  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) return JSON.parse(fence[1].trim());
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("planner output was not valid JSON");
  }
}

function plannerInstruction(pending: PendingCapture): string {
  return [
    "Create a concise SOP ResourceCard draft from this redacted capture digest.",
    "Return strict JSON only with keys: title, body, facts, repro, resolution, triggers.",
    "Do not include visibility, raw secrets, or fields outside that schema.",
    `Classification is fixed as ${pending.classification}; do not override it.`,
  ].join("\n");
}

function plannerPack(pending: PendingCapture): string {
  return JSON.stringify({
    id: pending.id,
    classification: pending.classification,
    classificationScores: pending.classificationScores,
    digest: pending.digest,
    sourceLines: pending.sourceLines,
    provenance: pending.provenance,
  }, null, 2);
}

function parsePlannerSop(raw: string): PlannerSop {
  return PlannerSopSchema.parse(extractJson(raw));
}

function redactArray(values: string[]): string[] {
  return values.map((value) => redactText(value).text).filter((value) => value.trim().length > 0);
}

function excerpt(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= 240 ? trimmed : `${trimmed.slice(0, 237)}...`;
}

function defaultTriggers(pending: PendingCapture): string[] {
  return pending.digest.userPrompts
    .flatMap((prompt) => prompt.toLowerCase().split(/[^a-z0-9_.:/-]+/))
    .filter((token) => token.length >= 4)
    .slice(0, 8);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function buildCard(pending: PendingCapture, sop: PlannerSop, options: FinalizeOptions): ResourceCard {
  const body = redactText(sop.body).text;
  const resolution = redactText(sop.resolution).text.trim();
  const repro = redactArray(sop.repro);
  const facts = unique([...redactArray(pending.digest.facts), ...redactArray(sop.facts)]);
  const triggers = unique(redactArray(sop.triggers).length > 0 ? redactArray(sop.triggers) : defaultTriggers(pending));

  if (pending.classification === "debug" && (repro.length === 0 || !resolution)) {
    throw new Error("debug SOP requires repro and resolution");
  }
  if ((pending.classification === "feature" || pending.classification === "research") && !resolution) {
    throw new Error(`${pending.classification} SOP requires resolution`);
  }

  const card = ResourceCardSchema.parse({
    id: `sop-${slugify(sop.title)}-${pending.digest.fingerprint.slice(0, 12)}`,
    type: "sop",
    title: redactText(sop.title).text,
    category: "sop",
    tags: unique(["sop", pending.classification, ...triggers.slice(0, 5)]),
    timestamp: (options.now ?? new Date()).toISOString(),
    body,
    excerpt: excerpt(body),
    kind: pending.classification,
    facts,
    environment: pending.digest.environment,
    repro,
    resolution,
    triggers,
    visibility: options.share === true ? "shared" : "local",
    captureMeta: {
      sessionId: pending.sessionId,
      fingerprint: pending.digest.fingerprint,
      toolSequence: pending.digest.toolSequence,
      capturedAt: pending.capturedAt,
    },
  });

  if (containsUnredactedSecret({
    title: card.title,
    body: card.body,
    facts: card.facts,
    repro: card.repro,
    resolution: card.resolution,
    triggers: card.triggers,
  })) {
    throw new Error("final SOP contains unredacted secret-like content");
  }
  return card;
}

function triggerOverlap(a: string[] | undefined, b: string[]): boolean {
  const left = new Set((a ?? []).map((value) => value.toLowerCase()));
  return b.some((value) => left.has(value.toLowerCase()));
}

function dedupCandidate(cards: ResourceCard[], pending: PendingCapture, triggers: string[]): ResourceCard | undefined {
  return cards.find((card) => {
    if (card.captureMeta?.fingerprint === pending.digest.fingerprint) return true;
    if (card.kind === pending.classification && triggerOverlap(card.triggers, triggers)) return true;
    return false;
  });
}

export async function finalizePendingCapture(root: string, id: string, options: FinalizeOptions): Promise<FinalizeResult> {
  const pending = readPendingCapture(root, id);
  const raw = await options.planner.ask({
    mode: "sop-finalize",
    phaseKey: `capture:${pending.id}`,
    instruction: plannerInstruction(pending),
    pack: plannerPack(pending),
  });
  const sop = parsePlannerSop(raw);
  const card = buildCard(pending, sop, options);
  const cards = getAll(root);
  const candidate = dedupCandidate(cards, pending, card.triggers ?? []);

  if (candidate && options.decision === undefined) {
    throw new Error(`duplicate SOP candidate: ${candidate.id}; rerun with --add or --refine ${candidate.id}`);
  }

  if (options.decision === "refine" || options.refineId) {
    const targetId = options.refineId ?? candidate?.id;
    if (!targetId) throw new Error("refine requires an existing resource id");
    const existing = cards.find((item) => item.id === targetId);
    if (!existing) throw new Error(`resource not found: ${targetId}`);
    const refined = ResourceCardSchema.parse({
      ...existing,
      ...card,
      id: existing.id,
      visibility: options.share === true ? "shared" : existing.visibility,
      links: existing.links,
      sourcePaths: existing.sourcePaths,
      resource: existing.resource,
      contentHash: existing.contentHash,
      contentSize: existing.contentSize,
    });
    writeAll(root, cards.map((item) => item.id === existing.id ? refined : item));
    renderOkfBundle(root, getAll(root));
    discardPendingCapture(root, pending.id);
    return { action: "refined", card: refined, pending };
  }

  if (cards.some((item) => item.id === card.id)) throw new Error(`duplicate resource id: ${card.id}; rerun with --refine <id>`);
  writeAll(root, [...cards, card]);
  renderOkfBundle(root, getAll(root));
  discardPendingCapture(root, pending.id);
  return { action: "added", card, pending };
}
