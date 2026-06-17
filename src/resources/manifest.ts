import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import {
  ResourceCardSchema,
  ResourceRelationSchema,
  type ResourceCard,
  type ResourceRelation,
} from "../format/schema.js";
import { ensureParentDir, resourcesManifestPath } from "../format/paths.js";

let tmpCounter = 0;

function formatIssues(error: { issues: Array<{ path: Array<string | number>; message: string }> }): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function parseManifestContent(content: string, label: string): ResourceCard[] {
  const cards: ResourceCard[] = [];
  const lines = content.split(/\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;

    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${label}: line ${index + 1}: invalid JSON: ${message}`);
    }

    const parsed = ResourceCardSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`${label}: line ${index + 1}: invalid ResourceCard: ${formatIssues(parsed.error)}`);
    }
    cards.push(parsed.data);
  }
  return cards;
}

function parseManifestFile(path: string): ResourceCard[] {
  return parseManifestContent(readFileSync(path, "utf8"), path);
}

function tempPath(path: string): string {
  tmpCounter += 1;
  return `${path}.tmp-${process.pid}-${tmpCounter}`;
}

export function getAll(root: string): ResourceCard[] {
  const path = resourcesManifestPath(root);
  if (!existsSync(path)) return [];
  return parseManifestFile(path);
}

function compareCards(a: ResourceCard, b: ResourceCard): number {
  return a.category.localeCompare(b.category) ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function normalizeCard(card: ResourceCard): ResourceCard {
  return {
    ...card,
    sourcePaths: card.sourcePaths ? uniqueSorted(card.sourcePaths) : card.sourcePaths,
  };
}

function assertUniqueIds(cards: ResourceCard[]): void {
  const seen = new Set<string>();
  for (const card of cards) {
    if (seen.has(card.id)) throw new Error(`duplicate resource id: ${card.id}`);
    seen.add(card.id);
  }
}

export function writeAll(root: string, cards: ResourceCard[]): void {
  const path = resourcesManifestPath(root);
  const validated = cards.map((card, index) => {
    const parsed = ResourceCardSchema.safeParse(card);
    if (!parsed.success) {
      throw new Error(`resource card ${index + 1}: invalid ResourceCard: ${formatIssues(parsed.error)}`);
    }
    return normalizeCard(parsed.data);
  });
  assertUniqueIds(validated);

  const data = [...validated].sort(compareCards).map((card) => JSON.stringify(card)).join("\n") + (validated.length > 0 ? "\n" : "");
  const tmp = tempPath(path);

  ensureParentDir(path);
  try {
    writeFileSync(tmp, data, { flag: "wx" });
    parseManifestFile(tmp);
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // Best-effort cleanup must not hide the validation or write failure.
    }
    throw error;
  }
}

export function add(root: string, card: ResourceCard): ResourceCard {
  const parsed = ResourceCardSchema.parse(card);
  const current = getAll(root);
  if (parsed.contentHash) {
    const existing = current.find((candidate) => candidate.contentHash === parsed.contentHash);
    if (existing) {
      const sourcePaths = uniqueSorted([...(existing.sourcePaths ?? []), ...(parsed.sourcePaths ?? [])]);
      const merged = { ...existing, sourcePaths };
      writeAll(root, current.map((candidate) => candidate.id === existing.id ? merged : candidate));
      return merged;
    }
  }
  if (current.some((candidate) => candidate.id === parsed.id)) throw new Error(`duplicate resource id: ${parsed.id}`);
  writeAll(root, [...current, parsed]);
  return parsed;
}

function requireCard(cards: ResourceCard[], id: string): ResourceCard {
  const card = cards.find((candidate) => candidate.id === id);
  if (!card) throw new Error(`resource not found: ${id}`);
  return card;
}

export function linkCards(cards: ResourceCard[], fromId: string, rel: string, toId: string): ResourceCard[] {
  const relation = ResourceRelationSchema.safeParse(rel);
  if (!relation.success) throw new Error(`invalid relation type: ${rel}`);
  requireCard(cards, fromId);
  requireCard(cards, toId);
  return cards.map((card) => {
    if (card.id !== fromId) return card;
    return {
      ...card,
      links: [...(card.links ?? []), { rel: relation.data, toId }],
    };
  });
}

export function link(root: string, fromId: string, rel: ResourceRelation | string, toId: string): ResourceCard {
  const cards = linkCards(getAll(root), fromId, rel, toId);
  writeAll(root, cards);
  return requireCard(cards, fromId);
}

export interface RemoveResult {
  removed: ResourceCard;
  cards: ResourceCard[];
  removedLinks: number;
}

export function removeCard(cards: ResourceCard[], id: string): RemoveResult {
  const removed = requireCard(cards, id);
  let removedLinks = 0;
  const remaining = cards
    .filter((card) => card.id !== id)
    .map((card) => {
      const links = card.links ?? [];
      const kept = links.filter((link) => link.toId !== id);
      removedLinks += links.length - kept.length;
      return kept.length === links.length ? card : { ...card, links: kept.length > 0 ? kept : undefined };
    });
  return { removed, cards: remaining, removedLinks };
}

export function remove(root: string, id: string): RemoveResult {
  const result = removeCard(getAll(root), id);
  writeAll(root, result.cards);
  return result;
}
