import { z } from "zod";
import { PlannerUnavailableError, type PlannerBackend } from "../backends/planner.js";
import {
  ResourceCardSchema,
  ResourceRelationSchema,
  type ResourceCard,
  type ResourceLink,
  type ResourceOwns,
} from "../format/schema.js";
import { sanitize } from "../redact/sanitize.js";
import { relatedCandidates } from "./candidates.js";
import { getAll, writeAll } from "./manifest.js";
import { renderOkfBundle } from "./okf.js";
import { resolveSchemaSource } from "./schemaSource.js";

const defaultBatchSize = 8; // smaller batches keep the planner's JSON response within limits — candidate-grounded linking makes per-card output larger
const defaultConcurrency = 1;
const defaultMaxExcerptChars = 1200;
const defaultMaxIndexEntries = 500;
const defaultMaxIndexChars = 16000;
const defaultCandidateCount = 6;
const MAX_ENRICHMENT_ENTRIES = 1000;

const PlannerOwnsSchema = z.object({
  symbols: z.array(z.string()).optional(),
  endpoints: z.array(z.string()).optional(),
  configKeys: z.array(z.string()).optional(),
});

const PlannerLinkSchema = z.object({
  rel: ResourceRelationSchema,
  toId: z.string(),
});

const PlannerCardEnrichmentSchema = z.object({
  category: z.string().min(1).max(120).optional(),
  tags: z.array(z.string().max(120)).max(50),
  intent: z.string().max(200).optional(),
  owns: PlannerOwnsSchema,
  schemaSource: z.array(z.string().max(400)).max(50),
  links: z.array(PlannerLinkSchema).max(100),
});

export type PlannerCardEnrichment = z.infer<typeof PlannerCardEnrichmentSchema>;

export interface EnrichOptions {
  planner: PlannerBackend;
  category?: string;
  limit?: number;
  dryRun?: boolean;
  reenrich?: boolean;
  now?: Date;
  batchSize?: number;
  concurrency?: number;
  maxExcerptChars?: number;
  maxIndexEntries?: number;
  maxIndexChars?: number;
}

export interface EnrichSummary {
  selected: number;
  enriched: number;
  skipped: number;
  failed: number;
  unchanged: number;
  halted?: boolean;
  haltReason?: string;
}

export interface EnrichResult {
  dryRun: boolean;
  events: Array<Record<string, unknown>>;
  summary: EnrichSummary;
}

interface PreparedBatchSuccess {
  ok: true;
  batchIndex: number;
  totalBatches: number;
  cards: ResourceCard[];
  enrichments: Map<string, PlannerCardEnrichment>;
  latencyMs: number;
}

interface PreparedBatchFailure {
  ok: false;
  batchIndex: number;
  totalBatches: number;
  cards: ResourceCard[];
  reason: string;
  unavailable: boolean;
  latencyMs: number;
}

type PreparedBatch = PreparedBatchSuccess | PreparedBatchFailure;

function assertPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function formatIssues(error: { issues: Array<{ path: Array<string | number>; message: string }> }): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function extractJson(value: string): unknown {
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

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function cardExcerpt(card: ResourceCard, maxChars: number): string {
  return clip((card.excerpt ?? card.body ?? card.description ?? "").trim(), maxChars);
}

function buildLinkTargetIndex(cards: ResourceCard[], maxEntries: number, maxChars: number): { index: Record<string, string>; omitted: number } {
  const index: Record<string, string> = {};
  let usedChars = 2;
  let included = 0;
  const sorted = [...cards].sort((a, b) => a.id.localeCompare(b.id));

  for (const card of sorted) {
    if (included >= maxEntries) break;
    const entryChars = JSON.stringify({ [card.id]: card.title }).length + (included > 0 ? 1 : 0);
    if (usedChars + entryChars > maxChars) break;
    index[card.id] = card.title;
    usedChars += entryChars;
    included += 1;
  }

  return { index, omitted: cards.length - included };
}

function plannerPack(batch: ResourceCard[], allCards: ResourceCard[], options: Required<Pick<EnrichOptions, "maxExcerptChars" | "maxIndexEntries" | "maxIndexChars">>): string {
  const linkTargets = buildLinkTargetIndex(allCards, options.maxIndexEntries, options.maxIndexChars);
  return JSON.stringify({
    cards: batch.map((card) => ({
      id: card.id,
      title: card.title,
      excerpt: cardExcerpt(card, options.maxExcerptChars),
      candidates: relatedCandidates(card, allCards, defaultCandidateCount).map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        why: candidate.reasons.join("; "),
      })),
    })),
    linkTargets: linkTargets.index,
    omittedLinkTargets: linkTargets.omitted,
  }, null, 2);
}

function plannerInstruction(): string {
  return [
    "Enrich each resource card with retrieval metadata only.",
    "Return strict JSON only: an object keyed by resource id.",
    "Each value must match exactly these fields: category optional string, tags string[], intent optional string, owns { symbols?: string[], endpoints?: string[], configKeys?: string[] }, schemaSource string[], links { rel, toId }[].",
    "Allowed rel values: defines, references, relates-to, depends-on.",
    "Each card includes a `candidates` list of likely-related cards (with why). Link a card to a candidate when the relationship is genuine, choosing the rel (defines|references|relates-to|depends-on); prefer candidates over the flat linkTargets, but you may use linkTargets for cross-topic links. Do not invent ids.",
    "Use only toId values present in a card's candidates or linkTargets. Do not invent ids.",
    "Do not include visibility, body, resource, sourcePaths, contentHash, contentSize, or fields outside the enrichment schema.",
  ].join("\n");
}

function parsePlannerBatch(raw: string, cards: ResourceCard[]): Map<string, PlannerCardEnrichment> {
  const record = z.record(z.unknown()).parse(extractJson(raw));
  if (Object.keys(record).length > MAX_ENRICHMENT_ENTRIES) {
    throw new Error(`planner returned too many enrichment entries (${Object.keys(record).length})`);
  }
  const enrichments = new Map<string, PlannerCardEnrichment>();

  for (const card of cards) {
    const rawCard = record[card.id];
    if (rawCard === undefined) throw new Error(`missing enrichment for ${card.id}`);
    const parsed = PlannerCardEnrichmentSchema.safeParse(rawCard);
    if (!parsed.success) {
      throw new Error(`invalid enrichment for ${card.id}: ${formatIssues(parsed.error)}`);
    }
    enrichments.set(card.id, parsed.data);
  }

  return enrichments;
}

function cleanString(value: string): string {
  return sanitize(value).trim();
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map(cleanString).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function uniqueSortedTags(values: string[]): string[] {
  return [...new Set(values.map((value) => cleanString(value).toLowerCase()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function mergeOwns(existing: ResourceOwns | undefined, enrichment: PlannerCardEnrichment["owns"]): ResourceOwns {
  return {
    symbols: uniqueSorted([...(existing?.symbols ?? []), ...(enrichment.symbols ?? [])]),
    endpoints: uniqueSorted([...(existing?.endpoints ?? []), ...(enrichment.endpoints ?? [])]),
    configKeys: uniqueSorted([...(existing?.configKeys ?? []), ...(enrichment.configKeys ?? [])]),
  };
}

function mergeLinks(existing: ResourceLink[] | undefined, enrichment: PlannerCardEnrichment["links"], knownIds: Set<string>, currentId: string): ResourceLink[] | undefined {
  const byTarget = new Map<string, ResourceLink>();
  for (const link of [...(existing ?? []), ...enrichment]) {
    const toId = cleanString(link.toId);
    if (!toId || toId === currentId || !knownIds.has(toId) || byTarget.has(toId)) continue;
    byTarget.set(toId, { rel: link.rel, toId });
  }
  const links = [...byTarget.values()].sort((a, b) => a.toId.localeCompare(b.toId) || a.rel.localeCompare(b.rel));
  return links.length > 0 ? links : undefined;
}

function enrichmentFields(card: ResourceCard): Record<string, unknown> {
  return {
    category: card.category,
    tags: card.tags,
    intent: card.intent,
    owns: card.owns,
    schemaSource: card.schemaSource,
    links: card.links,
    enrichedAt: card.enrichedAt,
  };
}

function changedFields(before: ResourceCard, after: ResourceCard): string[] {
  const left = enrichmentFields(before);
  const right = enrichmentFields(after);
  return Object.keys(right).filter((field) => JSON.stringify(left[field]) !== JSON.stringify(right[field]));
}

function mergeEnrichment(root: string, card: ResourceCard, enrichment: PlannerCardEnrichment, knownIds: Set<string>, enrichedAt: string): ResourceCard {
  const category = enrichment.category === undefined ? card.category : cleanString(enrichment.category);
  const intent = enrichment.intent === undefined ? card.intent : cleanString(enrichment.intent) || card.intent;
  const next = ResourceCardSchema.parse({
    ...card,
    category: category || card.category,
    tags: uniqueSortedTags([...card.tags, ...enrichment.tags]),
    ...(intent !== undefined ? { intent } : {}),
    owns: mergeOwns(card.owns, enrichment.owns),
    schemaSource: uniqueSorted(
      [...(card.schemaSource ?? []), ...enrichment.schemaSource]
        .map((s) => cleanString(s))
        .filter(Boolean)
        .filter((ref) => resolveSchemaSource(root, ref).status === "resolved"),
    ),
    links: mergeLinks(card.links, enrichment.links, knownIds, card.id),
    enrichedAt,
  });
  return next;
}

async function prepareBatch(
  planner: PlannerBackend,
  batch: ResourceCard[],
  allCards: ResourceCard[],
  batchIndex: number,
  totalBatches: number,
  events: Array<Record<string, unknown>>,
  packOptions: Required<Pick<EnrichOptions, "maxExcerptChars" | "maxIndexEntries" | "maxIndexChars">>,
): Promise<PreparedBatch> {
  const startedAt = Date.now();
  events.push({
    event: "batch-start",
    batch: batchIndex + 1,
    totalBatches,
    count: batch.length,
    cardIds: batch.map((card) => card.id),
  });

  try {
    const raw = await planner.ask({
      mode: "resources-enrich",
      phaseKey: `resources-enrich:${batchIndex + 1}`,
      instruction: plannerInstruction(),
      pack: plannerPack(batch, allCards, packOptions),
    });
    return {
      ok: true,
      batchIndex,
      totalBatches,
      cards: batch,
      enrichments: parsePlannerBatch(raw, batch),
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      batchIndex,
      totalBatches,
      cards: batch,
      reason,
      unavailable: error instanceof PlannerUnavailableError,
      latencyMs: Date.now() - startedAt,
    };
  }
}

function commitBatch(
  root: string,
  prepared: PreparedBatchSuccess,
  options: { dryRun: boolean; knownIds: Set<string>; enrichedAt: string; events: Array<Record<string, unknown>> },
): { enriched: number; unchanged: number } {
  const current = getAll(root);
  const byId = new Map(current.map((card) => [card.id, card]));
  const updates = new Map<string, ResourceCard>();
  let enriched = 0;
  let unchanged = 0;

  for (const card of prepared.cards) {
    const currentCard = byId.get(card.id);
    const enrichment = prepared.enrichments.get(card.id);
    if (!currentCard || !enrichment) continue;
    const next = mergeEnrichment(root, currentCard, enrichment, options.knownIds, options.enrichedAt);
    const fields = changedFields(currentCard, next);
    if (fields.length === 0) {
      unchanged += 1;
      options.events.push({ event: "card-unchanged", id: currentCard.id, batch: prepared.batchIndex + 1 });
    } else {
      enriched += 1;
      updates.set(currentCard.id, next);
      options.events.push({
        event: "card-change",
        id: currentCard.id,
        batch: prepared.batchIndex + 1,
        fields,
        after: enrichmentFields(next),
      });
    }
  }

  if (!options.dryRun && updates.size > 0) {
    const nextCards = current.map((card) => updates.get(card.id) ?? card);
    writeAll(root, nextCards);
    renderOkfBundle(root, nextCards);
  }

  return { enriched, unchanged };
}

export async function enrichResources(root: string, options: EnrichOptions): Promise<EnrichResult> {
  const batchSize = assertPositiveInteger(options.batchSize ?? defaultBatchSize, "batchSize");
  const concurrency = assertPositiveInteger(options.concurrency ?? defaultConcurrency, "concurrency");
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 0)) {
    throw new Error("limit must be a nonnegative integer");
  }

  const dryRun = options.dryRun === true;
  const reenrich = options.reenrich === true;
  const allCards = getAll(root);
  const scoped = allCards.filter((card) => options.category === undefined || card.category === options.category);
  const skipped = reenrich ? 0 : scoped.filter((card) => card.enrichedAt !== undefined).length;
  const candidates = scoped
    .filter((card) => reenrich || card.enrichedAt === undefined)
    .slice(0, options.limit);
  const batches = chunk(candidates, batchSize);
  const events: Array<Record<string, unknown>> = [];
  const summary: EnrichSummary = { selected: candidates.length, enriched: 0, skipped, failed: 0, unchanged: 0 };
  const knownIds = new Set(allCards.map((card) => card.id));
  const enrichedAt = (options.now ?? new Date()).toISOString();
  const packOptions = {
    maxExcerptChars: options.maxExcerptChars ?? defaultMaxExcerptChars,
    maxIndexEntries: options.maxIndexEntries ?? defaultMaxIndexEntries,
    maxIndexChars: options.maxIndexChars ?? defaultMaxIndexChars,
  };

  const prepared: Array<Promise<PreparedBatch> | undefined> = [];
  let nextToStart = 0;
  const startNext = (): void => {
    if (nextToStart >= batches.length) return;
    const index = nextToStart;
    nextToStart += 1;
    prepared[index] = prepareBatch(options.planner, batches[index], allCards, index, batches.length, events, packOptions);
  };

  for (let index = 0; index < Math.min(concurrency, batches.length); index += 1) startNext();

  for (let index = 0; index < batches.length; index += 1) {
    const result = await prepared[index];
    if (!result) continue;
    if (!result.ok) {
      if (result.unavailable) {
        summary.halted = true;
        summary.haltReason = result.reason;
        events.push({ event: "halted", reason: result.reason });
        break;
      }
      summary.failed += result.cards.length;
      events.push({
        event: "batch-failed",
        batch: result.batchIndex + 1,
        totalBatches: result.totalBatches,
        count: result.cards.length,
        failed: result.cards.length,
        reason: result.reason,
        latencyMs: result.latencyMs,
        cardIds: result.cards.map((card) => card.id),
      });
      startNext();
      continue;
    }

    const counts = commitBatch(root, result, { dryRun, knownIds, enrichedAt, events });
    summary.enriched += counts.enriched;
    summary.unchanged += counts.unchanged;
    events.push({
      event: "batch-end",
      batch: result.batchIndex + 1,
      totalBatches: result.totalBatches,
      count: result.cards.length,
      enriched: counts.enriched,
      unchanged: counts.unchanged,
      failed: 0,
      latencyMs: result.latencyMs,
    });
    startNext();
  }

  events.push({
    event: "summary",
    dryRun,
    selected: summary.selected,
    enriched: summary.enriched,
    skipped: summary.skipped,
    failed: summary.failed,
    unchanged: summary.unchanged,
    halted: summary.halted === true,
    ...(summary.haltReason !== undefined ? { haltReason: summary.haltReason } : {}),
  });

  return { dryRun, events, summary };
}

export function renderEnrichResult(result: EnrichResult): string {
  return result.events.map((event) => JSON.stringify(event)).join("\n");
}
