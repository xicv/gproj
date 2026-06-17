import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { gprojDir, resourcesBundleDir } from "../format/paths.js";
import { ResourceCardSchema, type ResourceCard } from "../format/schema.js";

interface RenderedCard {
  card: ResourceCard;
  categoryDir: string;
  fileName: string;
}

let tmpCounter = 0;

export function segment(value: string): string {
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

function yamlLinks(card: ResourceCard): string[] {
  const links = card.links ?? [];
  if (links.length === 0) return ["links: []"];
  return [
    "links:",
    ...links.flatMap((link) => [
      `  - rel: ${yamlString(link.rel)}`,
      `    toId: ${yamlString(link.toId)}`,
    ]),
  ];
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
  if (card.contentSize !== undefined) lines.push(`contentSize: ${card.contentSize}`);
  lines.push(...yamlLinks(card));
  lines.push("---");
  return lines.join("\n");
}

function renderedById(cards: RenderedCard[]): Map<string, RenderedCard> {
  return new Map(cards.map((card) => [card.card.id, card]));
}

function relatedSection(card: ResourceCard, targets: Map<string, RenderedCard>): string {
  const links = [...(card.links ?? [])].sort((a, b) => a.rel.localeCompare(b.rel) || a.toId.localeCompare(b.toId));
  if (links.length === 0) return "## Related\n";
  const rendered = links.flatMap((link) => {
    const target = targets.get(link.toId);
    return target ? [`- [${target.card.title}](../${target.categoryDir}/${target.fileName})`] : [];
  });
  if (rendered.length === 0) return "## Related\n";
  return ["## Related", "", ...rendered].join("\n");
}

export function renderResourceMarkdown(card: ResourceCard): string {
  return renderResourceMarkdownWithTargets(card, renderedById(renderedCards([card])));
}

function renderResourceMarkdownWithTargets(card: ResourceCard, targets: Map<string, RenderedCard>): string {
  const parsed = ResourceCardSchema.parse(card);
  const body = parsed.body ?? parsed.excerpt ?? "";
  const sections = [frontmatter(parsed)];
  if (body.trim().length > 0) sections.push(body.trimEnd());
  sections.push(relatedSection(parsed, targets));
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

export function okfCardPath(card: ResourceCard): string {
  const parsed = ResourceCardSchema.parse(card);
  return `${segment(parsed.category)}/${segment(parsed.id)}.md`;
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

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

export function renderOkfFiles(cards: ResourceCard[]): Map<string, string> {
  const rendered = renderedCards(cards);
  const targets = renderedById(rendered);
  const files = new Map<string, string>();
  files.set("index.md", renderRootIndex(rendered));

  const byCategory = new Map<string, RenderedCard[]>();
  for (const item of rendered) {
    const group = byCategory.get(item.categoryDir) ?? [];
    group.push(item);
    byCategory.set(item.categoryDir, group);
  }

  for (const [categoryDir, group] of byCategory) {
    files.set(`${categoryDir}/index.md`, renderCategoryIndex(categoryDir, group));
    for (const item of group) files.set(`${categoryDir}/${item.fileName}`, renderResourceMarkdownWithTargets(item.card, targets));
  }
  return files;
}

function copyExistingAssets(root: string, tempDir: string): void {
  const assets = join(resourcesBundleDir(root), "_assets");
  if (!existsSync(assets)) return;
  cpSync(assets, join(tempDir, "_assets"), { recursive: true });
}

function writeFiles(tempDir: string, files: Map<string, string>): void {
  for (const [rel, content] of files) {
    const path = join(tempDir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { flag: "wx" });
  }
}

function validateRenderedFiles(tempDir: string, files: Map<string, string>): void {
  for (const [rel, content] of files) {
    const path = join(tempDir, rel);
    const actual = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (actual !== content) throw new Error(`OKF validation failed for ${rel}`);
  }
}

function swapDirectory(target: string, tempDir: string): void {
  const backup = `${target}.bak-${process.pid}-${++tmpCounter}`;
  let backedUp = false;
  try {
    if (existsSync(target)) {
      renameSync(target, backup);
      backedUp = true;
    }
    renameSync(tempDir, target);
    if (backedUp) rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    try {
      rmSync(target, { recursive: true, force: true });
    } catch {
      // Best-effort rollback must not hide the swap failure.
    }
    if (backedUp) {
      try {
        renameSync(backup, target);
      } catch {
        // If rollback fails, surface the original error.
      }
    }
    throw error;
  }
}

export function renderOkfBundle(root: string, cards: ResourceCard[]): void {
  const bundleDir = resourcesBundleDir(root);
  const parent = gprojDir(root);
  const tempDir = join(parent, `.resources.tmp-${process.pid}-${++tmpCounter}`);
  const files = renderOkfFiles(cards);

  mkdirSync(parent, { recursive: true });
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });
  try {
    copyExistingAssets(root, tempDir);
    writeFiles(tempDir, files);
    validateRenderedFiles(tempDir, files);
    swapDirectory(bundleDir, tempDir);
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

export function listOkfMarkdownFiles(root: string): string[] {
  const bundleDir = resourcesBundleDir(root);
  const files: string[] = [];
  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      if (name === "_assets") continue;
      const path = join(dir, name);
      const rel = toPosix(relative(bundleDir, path));
      if (existsSync(path) && statSync(path).isDirectory()) walk(path);
      else files.push(rel);
    }
  }
  if (existsSync(bundleDir)) walk(bundleDir);
  return files.sort();
}
