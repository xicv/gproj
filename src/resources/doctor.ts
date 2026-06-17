import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";
import { resourcesBundleDir, resourcesManifestPath } from "../format/paths.js";
import { ResourceCardSchema, type ResourceCard } from "../format/schema.js";
import { normalizeText, sha256, toPosix } from "./import.js";
import { listOkfMarkdownFiles, renderOkfFiles } from "./okf.js";

export interface ResourceDiagnostic {
  level: "warning";
  message: string;
}

interface ManifestRead {
  cards: ResourceCard[];
  diagnostics: ResourceDiagnostic[];
}

function formatIssues(error: { issues: Array<{ path: Array<string | number>; message: string }> }): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function warning(message: string): ResourceDiagnostic {
  return { level: "warning", message };
}

function readManifest(root: string): ManifestRead {
  const path = resourcesManifestPath(root);
  if (!existsSync(path)) return { cards: [], diagnostics: [] };
  const cards: ResourceCard[] = [];
  const diagnostics: ResourceDiagnostic[] = [];
  const lines = readFileSync(path, "utf8").split(/\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push(warning(`manifest line ${index + 1}: invalid JSON: ${message}`));
      continue;
    }
    const parsed = ResourceCardSchema.safeParse(raw);
    if (!parsed.success) {
      diagnostics.push(warning(`manifest line ${index + 1}: invalid ResourceCard: ${formatIssues(parsed.error)}`));
      continue;
    }
    cards.push(parsed.data);
  }
  return { cards, diagnostics };
}

function safeAssetPath(root: string, resource: string): string | null {
  if (!resource.startsWith("_assets/")) return null;
  const normalized = normalize(resource).split(sep).join("/");
  if (!normalized.startsWith("_assets/") || normalized.startsWith("../") || normalized.includes("/../") || isAbsolute(normalized)) return null;
  return join(resourcesBundleDir(root), normalized);
}

function diagnoseDuplicateIds(cards: ResourceCard[]): ResourceDiagnostic[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const card of cards) {
    if (seen.has(card.id)) duplicates.add(card.id);
    seen.add(card.id);
  }
  return [...duplicates].sort().map((id) => warning(`duplicate resource id: ${id}`));
}

function diagnoseLinks(cards: ResourceCard[]): ResourceDiagnostic[] {
  const ids = new Set(cards.map((card) => card.id));
  const diagnostics: ResourceDiagnostic[] = [];
  for (const card of cards) {
    for (const link of card.links ?? []) {
      if (!ids.has(link.toId)) diagnostics.push(warning(`dangling link: ${card.id} ${link.rel} -> ${link.toId}`));
    }
  }
  return diagnostics;
}

function diagnoseAssets(root: string, cards: ResourceCard[]): ResourceDiagnostic[] {
  const diagnostics: ResourceDiagnostic[] = [];
  for (const card of cards) {
    if (!card.resource) continue;
    const path = safeAssetPath(root, card.resource);
    if (!path) {
      diagnostics.push(warning(`invalid asset path for ${card.id}: ${card.resource}`));
      continue;
    }
    if (!existsSync(path)) {
      diagnostics.push(warning(`missing asset for ${card.id}: ${card.resource}`));
      continue;
    }
    if (card.contentHash) {
      const actual = sha256(readFileSync(path));
      if (actual !== card.contentHash) diagnostics.push(warning(`contentHash drift for asset ${card.id}: ${card.resource}`));
    }
  }
  return diagnostics;
}

function diagnoseContentHash(cards: ResourceCard[]): ResourceDiagnostic[] {
  const diagnostics: ResourceDiagnostic[] = [];
  for (const card of cards) {
    if (!card.contentHash || card.body === undefined) continue;
    const actual = sha256(normalizeText(Buffer.from(card.body, "utf8")));
    if (actual !== card.contentHash) diagnostics.push(warning(`contentHash drift for text ${card.id}`));
  }
  return diagnostics;
}

function diagnoseOrphans(cards: ResourceCard[]): ResourceDiagnostic[] {
  const inbound = new Map<string, number>(cards.map((card) => [card.id, 0]));
  for (const card of cards) {
    for (const link of card.links ?? []) inbound.set(link.toId, (inbound.get(link.toId) ?? 0) + 1);
  }
  return cards
    .filter((card) => (card.links ?? []).length === 0 && (inbound.get(card.id) ?? 0) === 0 && (card.sourcePaths ?? []).length === 0)
    .map((card) => warning(`orphaned resource card: ${card.id}`));
}

function diagnoseBundle(root: string, cards: ResourceCard[]): ResourceDiagnostic[] {
  const diagnostics: ResourceDiagnostic[] = [];
  const bundleDir = resourcesBundleDir(root);
  const expected = renderOkfFiles(cards);
  const actualFiles = listOkfMarkdownFiles(root);

  if (cards.length === 0 && !existsSync(bundleDir)) return diagnostics;
  if (expected.size > 0 && !existsSync(bundleDir)) {
    diagnostics.push(warning("OKF bundle missing: .gproj/resources"));
    return diagnostics;
  }

  for (const [rel, content] of expected) {
    const path = join(bundleDir, rel);
    if (!existsSync(path)) {
      diagnostics.push(warning(`OKF bundle drift: missing ${rel}`));
      continue;
    }
    if (readFileSync(path, "utf8") !== content) diagnostics.push(warning(`OKF bundle drift: content mismatch ${rel}`));
  }

  const expectedPaths = new Set(expected.keys());
  for (const rel of actualFiles) {
    const normalized = toPosix(rel);
    if (!expectedPaths.has(normalized)) diagnostics.push(warning(`OKF bundle drift: unexpected ${normalized}`));
    if (normalized !== "index.md") {
      const parts = normalized.split("/");
      if (parts.length !== 2 || parts[0] === "" || !parts[1].endsWith(".md")) {
        diagnostics.push(warning(`invalid category directory structure: ${normalized}`));
      }
    }
  }

  return diagnostics;
}

function diagnoseCategoryDirectories(root: string, cards: ResourceCard[]): ResourceDiagnostic[] {
  const diagnostics: ResourceDiagnostic[] = [];
  const bundleDir = resourcesBundleDir(root);
  if (!existsSync(bundleDir)) return diagnostics;
  const expected = new Set([...renderOkfFiles(cards).keys()].map((path) => path.split("/")[0]).filter((path) => path !== "index.md"));
  for (const rel of listOkfMarkdownFiles(root)) {
    const first = rel.split("/")[0];
    if (first !== "index.md" && !expected.has(first)) diagnostics.push(warning(`invalid category directory structure: ${rel}`));
  }
  return diagnostics;
}

export function diagnoseResources(root: string): ResourceDiagnostic[] {
  const manifest = readManifest(root);
  const cards = manifest.cards;
  return [
    ...manifest.diagnostics,
    ...diagnoseDuplicateIds(cards),
    ...diagnoseLinks(cards),
    ...diagnoseAssets(root, cards),
    ...diagnoseContentHash(cards),
    ...diagnoseOrphans(cards),
    ...diagnoseBundle(root, cards),
    ...diagnoseCategoryDirectories(root, cards),
  ];
}

export function renderResourceDoctor(root: string): string {
  const diagnostics = diagnoseResources(root);
  if (diagnostics.length === 0) return "resources doctor: ok";
  return [
    `resources doctor: ${diagnostics.length} warning${diagnostics.length === 1 ? "" : "s"}`,
    ...diagnostics.map((diagnostic) => `${diagnostic.level}: ${diagnostic.message}`),
  ].join("\n");
}
