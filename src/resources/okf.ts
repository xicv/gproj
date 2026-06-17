import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ensureParentDir, resourcesBundleDir } from "../format/paths.js";
import { atomicWrite } from "../format/store.js";
import { ResourceCardSchema, type ResourceCard } from "../format/schema.js";

interface RenderedCard {
  card: ResourceCard;
  categoryDir: string;
  fileName: string;
}

function segment(value: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || "uncategorized";
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlArray(name: string, values: string[]): string[] {
  if (values.length === 0) return [`${name}: []`];
  return [`${name}:`, ...values.map((value) => `  - ${yamlString(value)}`)];
}

function frontmatter(card: ResourceCard): string {
  const lines = [
    "---",
    `id: ${yamlString(card.id)}`,
    `type: ${yamlString(card.type)}`,
    `title: ${yamlString(card.title)}`,
    `category: ${yamlString(card.category)}`,
    ...yamlArray("tags", card.tags),
    `timestamp: ${yamlString(card.timestamp)}`,
  ];

  if (card.description !== undefined) lines.push(`description: ${yamlString(card.description)}`);
  if (card.resource !== undefined) lines.push(`resource: ${yamlString(card.resource)}`);
  if (card.excerpt !== undefined) lines.push(`excerpt: ${yamlString(card.excerpt)}`);
  if (card.sourcePaths !== undefined) lines.push(...yamlArray("sourcePaths", card.sourcePaths));
  if (card.contentHash !== undefined) lines.push(`contentHash: ${yamlString(card.contentHash)}`);
  lines.push("---");
  return lines.join("\n");
}

export function renderResourceMarkdown(card: ResourceCard): string {
  const parsed = ResourceCardSchema.parse(card);
  const body = parsed.body ?? parsed.excerpt ?? "";
  const sections = [frontmatter(parsed)];
  if (body.trim().length > 0) sections.push(body.trimEnd());
  sections.push("## Related\n");
  return `${sections.join("\n\n")}\n`;
}

function compareRendered(a: RenderedCard, b: RenderedCard): number {
  return a.categoryDir.localeCompare(b.categoryDir) ||
    a.card.title.localeCompare(b.card.title) ||
    a.card.id.localeCompare(b.card.id);
}

function renderedCards(cards: ResourceCard[]): RenderedCard[] {
  return cards
    .map((card) => {
      const parsed = ResourceCardSchema.parse(card);
      return {
        card: parsed,
        categoryDir: segment(parsed.category),
        fileName: `${segment(parsed.id)}.md`,
      };
    })
    .sort(compareRendered);
}

function resetBundle(root: string): void {
  const dir = resourcesBundleDir(root);
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) {
    if (name === "_assets") continue;
    rmSync(join(dir, name), { recursive: true, force: true });
  }
}

function renderRootIndex(cards: RenderedCard[]): string {
  if (cards.length === 0) return "# Resources\n\nNo resources.\n";
  const categories = new Map<string, RenderedCard[]>();
  for (const card of cards) {
    const group = categories.get(card.categoryDir) ?? [];
    group.push(card);
    categories.set(card.categoryDir, group);
  }

  const lines = ["# Resources", ""];
  for (const [categoryDir, group] of categories) {
    lines.push(`## ${categoryDir}`, "");
    for (const item of group) {
      lines.push(`- [${item.card.title}](${categoryDir}/${item.fileName})`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderCategoryIndex(categoryDir: string, cards: RenderedCard[]): string {
  const lines = [`# ${categoryDir}`, ""];
  for (const item of cards) lines.push(`- [${item.card.title}](${item.fileName})`);
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderOkfBundle(root: string, cards: ResourceCard[]): void {
  const rendered = renderedCards(cards);
  const bundleDir = resourcesBundleDir(root);
  resetBundle(root);

  atomicWrite(join(bundleDir, "index.md"), renderRootIndex(rendered));

  const byCategory = new Map<string, RenderedCard[]>();
  for (const item of rendered) {
    const group = byCategory.get(item.categoryDir) ?? [];
    group.push(item);
    byCategory.set(item.categoryDir, group);
  }

  for (const [categoryDir, group] of byCategory) {
    const dir = join(bundleDir, categoryDir);
    mkdirSync(dir, { recursive: true });
    atomicWrite(join(dir, "index.md"), renderCategoryIndex(categoryDir, group));
    for (const item of group) {
      const path = join(dir, item.fileName);
      ensureParentDir(path);
      atomicWrite(path, renderResourceMarkdown(item.card));
    }
  }
}
