import type { ResourceCard } from "../format/schema.js";
import { buildOkfIndex, type OkfIndexEntry } from "./okf.js";

export interface RankedResource {
  entry: OkfIndexEntry;
  priority: number;
  score: number;
  field: string;
  reason: string;
}

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9_.:/-]+/).filter(Boolean);
}

function phraseScore(value: string | undefined, query: string): number {
  if (!value) return 0;
  const haystack = value.toLowerCase();
  const needle = query.toLowerCase();
  if (haystack === needle) return 1000 + needle.length;
  if (haystack.includes(needle)) return 800 + needle.length;
  const queryTokens = tokens(query);
  if (queryTokens.length === 0) return 0;
  const matched = queryTokens.filter((token) => haystack.includes(token)).length;
  if (matched === 0) return 0;
  return matched * 100 + (matched === queryTokens.length ? 50 : 0);
}

function exactOwnsMatch(entry: OkfIndexEntry, query: string): RankedResource | null {
  const queryLower = query.toLowerCase();
  const fields = [
    { name: "owns.symbols", values: entry.owns?.symbols ?? [] },
    { name: "owns.endpoints", values: entry.owns?.endpoints ?? [] },
    { name: "owns.configKeys", values: entry.owns?.configKeys ?? [] },
  ];
  for (const [fieldIndex, field] of fields.entries()) {
    const valueIndex = field.values.findIndex((value) => value === query || value.toLowerCase() === queryLower);
    if (valueIndex >= 0) {
      const value = field.values[valueIndex];
      return {
        entry,
        priority: 1,
        score: 1000 - fieldIndex * 100 - valueIndex,
        field: field.name,
        reason: `${field.name}:${value}`,
      };
    }
  }
  return null;
}

function titleMatch(entry: OkfIndexEntry, query: string): RankedResource | null {
  const score = phraseScore(entry.title, query);
  if (score === 0) return null;
  return { entry, priority: 3, score, field: "title", reason: `title:${entry.title}` };
}

function tagsMatch(entry: OkfIndexEntry, query: string): RankedResource | null {
  const queryLower = query.toLowerCase();
  const index = entry.tags.findIndex((tag) => tag.toLowerCase() === queryLower || tag.toLowerCase().includes(queryLower));
  if (index < 0) return null;
  const tag = entry.tags[index];
  return {
    entry,
    priority: 4,
    score: tag.toLowerCase() === queryLower ? 1000 - index : 500 - index,
    field: "tags",
    reason: `tags:${tag}`,
  };
}

function bodyMatch(entry: OkfIndexEntry, card: ResourceCard | undefined, query: string): RankedResource | null {
  if (!card) return null;
  const queryLower = query.toLowerCase();
  const fields = [
    { name: "excerpt", value: card.excerpt },
    { name: "body", value: card.body },
    { name: "description", value: card.description },
  ];
  for (const [index, field] of fields.entries()) {
    if (field.value?.toLowerCase().includes(queryLower)) {
      return {
        entry,
        priority: 5,
        score: 1000 - index,
        field: field.name,
        reason: `${field.name}:substring`,
      };
    }
  }
  return null;
}

function bestResourceMatch(entry: OkfIndexEntry, card: ResourceCard | undefined, query: string): RankedResource | null {
  const owns = exactOwnsMatch(entry, query);
  if (owns) return owns;

  const intentScore = phraseScore(entry.intent, query);
  if (intentScore > 0) {
    return { entry, priority: 2, score: intentScore, field: "intent", reason: `intent:${entry.intent ?? ""}` };
  }

  return titleMatch(entry, query) ?? tagsMatch(entry, query) ?? bodyMatch(entry, card, query);
}

function compareRanked(a: RankedResource, b: RankedResource): number {
  return a.priority - b.priority ||
    b.score - a.score ||
    a.entry.category.localeCompare(b.entry.category) ||
    a.entry.title.localeCompare(b.entry.title) ||
    a.entry.id.localeCompare(b.entry.id);
}

export function rankFind(cards: ResourceCard[], query: string, entries: OkfIndexEntry[] = buildOkfIndex(cards)): RankedResource[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  return entries
    .flatMap((entry) => {
      const match = bestResourceMatch(entry, byId.get(entry.id), query);
      return match ? [match] : [];
    })
    .sort(compareRanked);
}
