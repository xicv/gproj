import type { ResourceCard, ResourceLink } from "../format/schema.js";

export interface AuditCount {
  count: number;
  percentage: number;
}

export interface AuditHub {
  id: string;
  degree: number;
}

export interface AuditDanglingLinkSample {
  fromId: string;
  rel: ResourceLink["rel"];
  toId: string;
}

export interface AuditReport {
  coverage: {
    total: number;
    enrichedAt: AuditCount;
    linked: AuditCount;
    tagged: AuditCount;
    intent: AuditCount;
    owns: AuditCount;
    schemaSource: AuditCount;
  };
  connectivity: {
    orphans: string[];
    componentCount: number;
    largestComponentSize: number;
    largestComponentPct: number;
    avgDegree: number;
    maxDegree: number;
    hubs: AuditHub[];
    density: number;
  };
  integrity: {
    danglingLinks: {
      count: number;
      sample: AuditDanglingLinkSample[];
    };
    selfLinks: number;
    duplicateLinks: number;
  };
  distribution: {
    categoryHistogram: Record<string, number>;
    topTags: Array<{ tag: string; count: number }>;
  };
  healthScore: number;
  flags: string[];
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentage(count: number, total: number): number {
  return total === 0 ? 0 : round((count / total) * 100);
}

function countMetric(count: number, total: number): AuditCount {
  return { count, percentage: percentage(count, total) };
}

function hasOwns(card: ResourceCard): boolean {
  return (card.owns?.symbols.length ?? 0) > 0 ||
    (card.owns?.endpoints.length ?? 0) > 0 ||
    (card.owns?.configKeys.length ?? 0) > 0;
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedEntries(map: Map<string, number>): Array<[string, number]> {
  return [...map.entries()].sort(([aKey, aValue], [bKey, bValue]) => bValue - aValue || aKey.localeCompare(bKey));
}

class UnionFind {
  private readonly parent = new Map<string, string>();
  private readonly size = new Map<string, number>();

  constructor(ids: string[]) {
    for (const id of ids) {
      this.parent.set(id, id);
      this.size.set(id, 1);
    }
  }

  find(id: string): string {
    const parent = this.parent.get(id);
    if (parent === undefined || parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string): void {
    const aRoot = this.find(a);
    const bRoot = this.find(b);
    if (aRoot === bRoot) return;
    const aSize = this.size.get(aRoot) ?? 1;
    const bSize = this.size.get(bRoot) ?? 1;
    const [root, child, rootSize, childSize] = aSize >= bSize
      ? [aRoot, bRoot, aSize, bSize]
      : [bRoot, aRoot, bSize, aSize];
    this.parent.set(child, root);
    this.size.set(root, rootSize + childSize);
    this.size.delete(child);
  }
}

function edgeKey(a: string, b: string): string {
  return a.localeCompare(b) <= 0 ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function duplicateKey(fromId: string, toId: string): string {
  return `${fromId}\u0000${toId}`;
}

function buildCoverage(cards: ResourceCard[]): AuditReport["coverage"] {
  const total = cards.length;
  return {
    total,
    enrichedAt: countMetric(cards.filter((card) => Boolean(card.enrichedAt)).length, total),
    linked: countMetric(cards.filter((card) => (card.links?.length ?? 0) > 0).length, total),
    tagged: countMetric(cards.filter((card) => card.tags.length > 0).length, total),
    intent: countMetric(cards.filter((card) => Boolean(card.intent)).length, total),
    owns: countMetric(cards.filter(hasOwns).length, total),
    schemaSource: countMetric(cards.filter((card) => (card.schemaSource?.length ?? 0) > 0).length, total),
  };
}

function buildDistribution(cards: ResourceCard[]): AuditReport["distribution"] {
  const categories = new Map<string, number>();
  const tags = new Map<string, number>();
  for (const card of cards) {
    increment(categories, card.category);
    for (const tag of card.tags) increment(tags, tag);
  }
  return {
    categoryHistogram: Object.fromEntries(sortedEntries(categories)),
    topTags: sortedEntries(tags).slice(0, 15).map(([tag, count]) => ({ tag, count })),
  };
}

export function auditCards(cards: ResourceCard[]): AuditReport {
  const ids = cards.map((card) => card.id);
  const idSet = new Set(ids);
  const degree = new Map(ids.map((id) => [id, 0]));
  const unionFind = new UnionFind(ids);
  const graphEdges = new Set<string>();
  const seenDirectedLinks = new Set<string>();
  const danglingSamples: AuditDanglingLinkSample[] = [];
  let danglingLinks = 0;
  let selfLinks = 0;
  let duplicateLinks = 0;

  for (const card of cards) {
    for (const link of card.links ?? []) {
      const directedKey = duplicateKey(card.id, link.toId);
      if (seenDirectedLinks.has(directedKey)) duplicateLinks += 1;
      seenDirectedLinks.add(directedKey);

      if (!idSet.has(link.toId)) {
        danglingLinks += 1;
        if (danglingSamples.length < 5) danglingSamples.push({ fromId: card.id, rel: link.rel, toId: link.toId });
        continue;
      }

      if (card.id === link.toId) {
        selfLinks += 1;
        continue;
      }

      const key = edgeKey(card.id, link.toId);
      if (graphEdges.has(key)) continue;
      graphEdges.add(key);
      degree.set(card.id, (degree.get(card.id) ?? 0) + 1);
      degree.set(link.toId, (degree.get(link.toId) ?? 0) + 1);
      unionFind.union(card.id, link.toId);
    }
  }

  const componentSizes = new Map<string, number>();
  for (const id of ids) increment(componentSizes, unionFind.find(id));
  const componentCount = cards.length === 0 ? 0 : componentSizes.size;
  const largestComponentSize = cards.length === 0 ? 0 : Math.max(...componentSizes.values());
  const largestComponentPct = percentage(largestComponentSize, cards.length);
  const degrees = ids.map((id) => degree.get(id) ?? 0);
  const orphans = ids.filter((id) => (degree.get(id) ?? 0) === 0).sort();
  const maxDegree = degrees.length === 0 ? 0 : Math.max(...degrees);
  const avgDegree = cards.length === 0 ? 0 : round(degrees.reduce((sum, value) => sum + value, 0) / cards.length);
  const possibleEdges = cards.length > 1 ? (cards.length * (cards.length - 1)) / 2 : 0;
  const density = possibleEdges === 0 ? 0 : round(graphEdges.size / possibleEdges, 4);
  const hubs = ids
    .map((id) => ({ id, degree: degree.get(id) ?? 0 }))
    .sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))
    .slice(0, 5);

  const coverage = buildCoverage(cards);
  const connectivity = {
    orphans,
    componentCount,
    largestComponentSize,
    largestComponentPct,
    avgDegree,
    maxDegree,
    hubs,
    density,
  };
  const integrity = {
    danglingLinks: {
      count: danglingLinks,
      sample: danglingSamples,
    },
    selfLinks,
    duplicateLinks,
  };

  const orphanRate = cards.length === 0 ? 0 : orphans.length / cards.length;
  const largestComponentRatio = cards.length === 0 ? 1 : largestComponentSize / cards.length;
  const enrichedRatio = cards.length === 0 ? 1 : coverage.enrichedAt.count / cards.length;
  // Health is intentionally monotonic and linear: more orphans or a smaller
  // largest component always increases penalty before the final integer round.
  const score = 100 -
    orphanRate * 40 -
    (1 - largestComponentRatio) * 30 -
    Math.min(15, danglingLinks * 3) -
    (selfLinks > 0 ? 5 : 0) -
    (1 - enrichedRatio) * 10;
  const healthScore = Math.max(0, Math.min(100, Math.round(score)));

  const flags: string[] = [];
  if (orphans.length > 0) flags.push(`${orphans.length} orphan cards (0 links)`);
  if (componentCount > 1) flags.push(`graph in ${componentCount} components`);
  if (danglingLinks > 0) flags.push(`${danglingLinks} dangling links`);
  if (selfLinks > 0) flags.push(`${selfLinks} self links`);
  if (duplicateLinks > 0) flags.push(`${duplicateLinks} duplicate links`);
  if (coverage.enrichedAt.percentage < 50 && cards.length > 0) flags.push(`low enrichment coverage (${coverage.enrichedAt.percentage}%)`);

  return {
    coverage,
    connectivity,
    integrity,
    distribution: buildDistribution(cards),
    healthScore,
    flags,
  };
}
