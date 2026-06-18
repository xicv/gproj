import { readFileSync, writeFileSync } from "node:fs";
import type { PlannerBackend } from "../backends/planner.js";
import { EvalSetSchema, type EvalSet, type ResourceCard, type ResourceLink } from "../format/schema.js";
import { sanitize } from "../redact/sanitize.js";
import { extractJson } from "./enrich.js";
import { rankFind } from "./find.js";
import { getAll } from "./manifest.js";

export interface RetrievalQueryMetric {
  query: string;
  expectedIds: string[];
  returnedIds: string[];
  precisionAtK: number;
  recall: number;
  ndcgAtK: number;
}

export interface RetrievalEvalReport {
  k: number;
  queryCount: number;
  meanPrecisionAtK: number;
  meanRecall: number;
  meanNdcgAtK: number;
  queries: RetrievalQueryMetric[];
  linkRecall?: {
    expected: number;
    found: number;
    recall: number;
  };
}

export interface EvalOptions {
  k?: number;
}

export interface GenerateEvalOptions {
  planner: PlannerBackend;
  sample?: number;
}

function assertK(value: number): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error("k must be a positive integer");
  return value;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function dcg(relevances: number[]): number {
  return relevances.reduce((sum, relevance, index) => sum + relevance / Math.log2(index + 2), 0);
}

function ndcg(returnedIds: string[], expected: Set<string>, k: number): number {
  if (expected.size === 0) return 0;
  const actual = returnedIds.slice(0, k).map((id) => expected.has(id) ? 1 : 0);
  const idealRelevant = Math.min(expected.size, k);
  const ideal = Array.from({ length: idealRelevant }, () => 1);
  const idealScore = dcg(ideal);
  return idealScore === 0 ? 0 : round(dcg(actual) / idealScore);
}

function linkKey(link: { fromId: string; rel: ResourceLink["rel"]; toId: string }): string {
  return `${link.fromId}\u0000${link.rel}\u0000${link.toId}`;
}

function actualLinkKeys(cards: ResourceCard[]): Set<string> {
  const keys = new Set<string>();
  for (const card of cards) {
    for (const link of card.links ?? []) keys.add(linkKey({ fromId: card.id, rel: link.rel, toId: link.toId }));
  }
  return keys;
}

export function evalRetrieval(root: string, evalset: EvalSet, options: EvalOptions = {}): RetrievalEvalReport {
  const k = assertK(options.k ?? 10);
  const cards = getAll(root);
  const queries = evalset.queries.map((item) => {
    const expected = new Set(item.expectedIds);
    const returnedIds = rankFind(cards, item.query).slice(0, k).map((match) => match.entry.id);
    const relevantReturned = returnedIds.filter((id) => expected.has(id)).length;
    return {
      query: item.query,
      expectedIds: item.expectedIds,
      returnedIds,
      precisionAtK: round(relevantReturned / k),
      recall: expected.size === 0 ? 0 : round(relevantReturned / expected.size),
      ndcgAtK: ndcg(returnedIds, expected, k),
    };
  });

  const report: RetrievalEvalReport = {
    k,
    queryCount: queries.length,
    meanPrecisionAtK: mean(queries.map((query) => query.precisionAtK)),
    meanRecall: mean(queries.map((query) => query.recall)),
    meanNdcgAtK: mean(queries.map((query) => query.ndcgAtK)),
    queries,
  };

  if (evalset.links !== undefined) {
    const actual = actualLinkKeys(cards);
    const found = evalset.links.filter((link) => actual.has(linkKey(link))).length;
    report.linkRecall = {
      expected: evalset.links.length,
      found,
      recall: evalset.links.length === 0 ? 0 : round(found / evalset.links.length),
    };
  }

  return report;
}

function formatIssues(error: { issues: Array<{ path: Array<string | number>; message: string }> }): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function parseEvalSetContent(content: string, label: string): EvalSet {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: invalid JSON: ${message}`);
  }
  const parsed = EvalSetSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${label}: invalid EvalSet: ${formatIssues(parsed.error)}`);
  return parsed.data;
}

export function readEvalSetFile(path: string): EvalSet {
  return parseEvalSetContent(readFileSync(path, "utf8"), path);
}

function excerpt(card: ResourceCard): string {
  return (card.excerpt ?? card.body ?? card.description ?? "").trim().slice(0, 800);
}

function sampleCards(cards: ResourceCard[], limit: number): ResourceCard[] {
  return [...cards].sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);
}

function plannerPack(cards: ResourceCard[]): string {
  return JSON.stringify({
    cards: cards.map((card) => ({
      id: card.id,
      title: card.title,
      category: card.category,
      tags: card.tags,
      intent: card.intent,
      excerpt: excerpt(card),
      links: card.links ?? [],
    })),
  }, null, 2);
}

function plannerInstruction(): string {
  return [
    "Propose a small resource retrieval evalset from these real cards.",
    "Return strict JSON only matching {\"queries\":[{\"query\":\"...\",\"expectedIds\":[\"real-id\"]}],\"links\":[{\"fromId\":\"real-id\",\"rel\":\"references\",\"toId\":\"real-id\"}]}",
    "Use only ids present in cards. Make realistic user queries for finding the expected resources.",
    "Allowed link rel values are defines, references, relates-to, depends-on. Include links only when supported by the cards.",
  ].join("\n");
}

function assertGeneratedIds(evalset: EvalSet, ids: Set<string>): EvalSet {
  for (const [queryIndex, query] of evalset.queries.entries()) {
    for (const id of query.expectedIds) {
      if (!ids.has(id)) throw new Error(`generated evalset query ${queryIndex + 1}: unknown expected id: ${id}`);
    }
  }
  for (const [linkIndex, link] of (evalset.links ?? []).entries()) {
    if (!ids.has(link.fromId)) throw new Error(`generated evalset link ${linkIndex + 1}: unknown fromId: ${link.fromId}`);
    if (!ids.has(link.toId)) throw new Error(`generated evalset link ${linkIndex + 1}: unknown toId: ${link.toId}`);
  }
  return evalset;
}

export async function generateEvalSet(root: string, options: GenerateEvalOptions): Promise<EvalSet> {
  const sample = assertK(options.sample ?? 20);
  const cards = getAll(root);
  const selected = sampleCards(cards, sample);
  const raw = await options.planner.ask({
    mode: "resources-eval-generate",
    phaseKey: "resources-eval-generate",
    pack: plannerPack(selected),
    instruction: plannerInstruction(),
  });
  const parsed = EvalSetSchema.safeParse(extractJson(raw));
  if (!parsed.success) throw new Error(`planner returned invalid EvalSet: ${formatIssues(parsed.error)}`);
  return assertGeneratedIds(parsed.data, new Set(cards.map((card) => card.id)));
}

export function writeEvalSet(path: string, evalset: EvalSet): void {
  writeFileSync(path, `${JSON.stringify(evalset, null, 2)}\n`);
}

function percent(value: number): string {
  return `${Math.round(value * 10000) / 100}%`;
}

export function renderRetrievalEvalReport(report: RetrievalEvalReport): string {
  const lines = [
    `resources eval: ${report.queryCount} queries, k=${report.k}`,
    `mean precision@${report.k}: ${percent(report.meanPrecisionAtK)}`,
    `mean recall: ${percent(report.meanRecall)}`,
    `mean nDCG@${report.k}: ${percent(report.meanNdcgAtK)}`,
  ];
  if (report.linkRecall) {
    lines.push(`link recall: ${report.linkRecall.found}/${report.linkRecall.expected} (${percent(report.linkRecall.recall)})`);
  }
  if (report.queries.length <= 20) {
    lines.push("queries:");
    for (const query of report.queries) {
      lines.push(`  ${sanitize(query.query)}: p@${report.k}=${percent(query.precisionAtK)} recall=${percent(query.recall)} ndcg=${percent(query.ndcgAtK)} returned=${query.returnedIds.join(",") || "none"}`);
    }
  }
  return lines.join("\n");
}
