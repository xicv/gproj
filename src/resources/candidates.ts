import type { ResourceCard } from "../format/schema.js";

export interface RelatedCandidate {
  id: string;
  title: string;
  reasons: string[];
  score: number;
}

function lowerSet(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function displayMap(values: string[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const value of values ?? []) {
    const cleaned = value.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (!map.has(key)) map.set(key, cleaned);
  }
  return map;
}

function intersection(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((value) => right.has(value)).sort((a, b) => a.localeCompare(b));
}

function intentWords(intent: string | undefined): Set<string> {
  return new Set(
    (intent ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((word) => word.length > 3),
  );
}

function ownsValues(card: ResourceCard): string[] {
  return [
    ...(card.owns?.symbols ?? []),
    ...(card.owns?.endpoints ?? []),
    ...(card.owns?.configKeys ?? []),
  ];
}

function formatReason(label: string, values: string[]): string {
  return `${label}: ${values.join(", ")}`;
}

export function relatedCandidates(card: ResourceCard, allCards: ResourceCard[], k = 6): RelatedCandidate[] {
  const cardTags = lowerSet(card.tags);
  const cardOwns = lowerSet(ownsValues(card));
  const cardOwnsDisplay = displayMap(ownsValues(card));
  const cardSchemaSources = lowerSet(card.schemaSource);
  const cardSchemaSourceDisplay = displayMap(card.schemaSource);
  const cardIntentWords = intentWords(card.intent);
  const category = card.category.trim().toLowerCase();

  return allCards
    .filter((candidate) => candidate.id !== card.id)
    .map((candidate): RelatedCandidate => {
      let score = 0;
      const reasons: string[] = [];

      const sharedTags = intersection(cardTags, lowerSet(candidate.tags));
      if (sharedTags.length > 0) {
        score += sharedTags.length * 2;
        reasons.push(formatReason("tags", sharedTags));
      }

      if (category && candidate.category.trim().toLowerCase() === category) {
        score += 2;
        reasons.push("same category");
      }

      const sharedOwns = intersection(cardOwns, lowerSet(ownsValues(candidate)));
      if (sharedOwns.length > 0) {
        score += sharedOwns.length * 3;
        reasons.push(formatReason("owns", sharedOwns.map((value) => cardOwnsDisplay.get(value) ?? value)));
      }

      const sharedSchemaSources = intersection(cardSchemaSources, lowerSet(candidate.schemaSource));
      if (sharedSchemaSources.length > 0) {
        score += sharedSchemaSources.length * 3;
        reasons.push(formatReason("schemaSource", sharedSchemaSources.map((value) => cardSchemaSourceDisplay.get(value) ?? value)));
      }

      const sharedIntentWords = intersection(cardIntentWords, intentWords(candidate.intent));
      if (sharedIntentWords.length > 0) {
        score += Math.min(sharedIntentWords.length, 3);
        reasons.push(formatReason("intent", sharedIntentWords));
      }

      return {
        id: candidate.id,
        title: candidate.title,
        reasons,
        score,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, k);
}
