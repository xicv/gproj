import { existsSync, lstatSync, readdirSync, statSync, unlinkSync, type Stats } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { resourcesBundleDir } from "../format/paths.js";
import { type ResourceCard } from "../format/schema.js";
import { createResourceCard, identityForFile, sourcePath, toPosix } from "./import.js";
import { getAll, writeAll } from "./manifest.js";
import { renderOkfBundle } from "./okf.js";

const excludedNames = new Set([".gproj", ".git", "node_modules", "dist", "build"]);

export interface OrganiseDuplicate {
  path: string;
  id: string;
  preExisting: boolean;
}

export interface DeleteCandidate {
  absolutePath: string;
  sourcePath: string;
  contentHash: string;
  fileSize: number;
}

export interface DeleteResult {
  path: string;
  deleted: boolean;
  reason?: string;
}

export interface OrganiseResult {
  scanned: number;
  imports: Array<{ path: string; id: string }>;
  duplicates: OrganiseDuplicate[];
  wouldDelete: string[];
  deleted: DeleteResult[];
  dryRun: boolean;
  deleteRequested: boolean;
}

export interface OrganiseOptions {
  dryRun?: boolean;
  deleteDuplicates?: boolean;
  category?: string;
  now?: Date;
  beforeDelete?: (candidate: DeleteCandidate) => void;
}

interface CandidateFile {
  absolutePath: string;
  sourcePath: string;
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function shouldSkipDir(root: string, path: string, name: string): boolean {
  if (excludedNames.has(name)) return true;
  return isInside(path, resourcesBundleDir(root));
}

function shouldSkipFile(root: string, path: string): boolean {
  if (isInside(path, resourcesBundleDir(root))) return true;
  const rel = toPosix(relative(root, path));
  return rel.split("/").some((segment) => excludedNames.has(segment));
}

function walk(root: string, dir: string, files: CandidateFile[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDir(root, path, entry.name)) walk(root, path, files);
    } else if (entry.isFile()) {
      if (!shouldSkipFile(root, path)) files.push({ absolutePath: path, sourcePath: sourcePath(root, path) });
    }
  }
}

export function scanResourceFiles(root: string, inputDir = "."): CandidateFile[] {
  const start = resolve(root, inputDir);
  if (!existsSync(start)) throw new Error(`resources organise path not found: ${inputDir}`);
  const stat = statSync(start);
  const files: CandidateFile[] = [];
  if (stat.isFile()) {
    if (!shouldSkipFile(root, start)) files.push({ absolutePath: start, sourcePath: sourcePath(root, start) });
  } else if (stat.isDirectory()) {
    if (!shouldSkipDir(root, start, start.split(sep).at(-1) ?? "")) walk(root, start, files);
  } else {
    throw new Error(`resources organise path is not a file or directory: ${inputDir}`);
  }
  return files.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

function withSourcePath(card: ResourceCard, path: string): ResourceCard {
  const sourcePaths = [...new Set([...(card.sourcePaths ?? []), path])].sort();
  return { ...card, sourcePaths };
}

function replaceCard(cards: ResourceCard[], next: ResourceCard): ResourceCard[] {
  return cards.map((card) => card.id === next.id ? next : card);
}

function mapByHash(cards: ResourceCard[]): Map<string, ResourceCard> {
  const byHash = new Map<string, ResourceCard>();
  for (const card of cards) {
    if (card.contentHash && !byHash.has(card.contentHash)) byHash.set(card.contentHash, card);
  }
  return byHash;
}

function categoryFromScanRoot(scanRootDir: string, absolutePath: string): string {
  const rootCategory = basename(scanRootDir) || "root";
  const parts = toPosix(relative(scanRootDir, absolutePath)).split("/").filter(Boolean);
  return parts.length > 1 ? parts[0] : rootCategory;
}

function sameStat(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
}

function safeDelete(candidate: DeleteCandidate, beforeDelete?: (candidate: DeleteCandidate) => void): DeleteResult {
  try {
    beforeDelete?.(candidate);
    const before = lstatSync(candidate.absolutePath);
    if (!before.isFile()) return { path: candidate.sourcePath, deleted: false, reason: "not a regular file" };
    if (before.size !== candidate.fileSize) return { path: candidate.sourcePath, deleted: false, reason: "size changed" };
    const currentHash = identityForFile(candidate.absolutePath).contentHash;
    const after = lstatSync(candidate.absolutePath);
    if (!sameStat(before, after)) return { path: candidate.sourcePath, deleted: false, reason: "file changed during verification" };
    if (currentHash !== candidate.contentHash) return { path: candidate.sourcePath, deleted: false, reason: "hash changed" };
    unlinkSync(candidate.absolutePath);
    return { path: candidate.sourcePath, deleted: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { path: candidate.sourcePath, deleted: false, reason: message };
  }
}

export function organiseResources(root: string, inputDir = ".", options: OrganiseOptions = {}): OrganiseResult {
  const dryRun = options.dryRun === true;
  const deleteRequested = options.deleteDuplicates === true;
  const scanRoot = resolve(root, inputDir);
  const files = scanResourceFiles(root, inputDir);
  const scanRootStat = statSync(scanRoot);
  const scanRootDir = scanRootStat.isFile() ? dirname(scanRoot) : scanRoot;
  const preRunCards = getAll(root);
  const preRunByHash = mapByHash(preRunCards);
  let cards: ResourceCard[] = preRunCards.map((card) => ({ ...card }));
  const byHash = mapByHash(cards);
  const imports: Array<{ path: string; id: string }> = [];
  const duplicates: OrganiseDuplicate[] = [];
  const deleteCandidates: DeleteCandidate[] = [];

  for (const file of files) {
    const identity = identityForFile(file.absolutePath);
    const preRunDuplicate = preRunByHash.get(identity.contentHash);
    const existing = byHash.get(identity.contentHash);

    if (preRunDuplicate) {
      const alreadySourced = (preRunDuplicate.sourcePaths ?? []).includes(file.sourcePath);
      const updated = withSourcePath(existing ?? preRunDuplicate, file.sourcePath);
      cards = replaceCard(cards, updated);
      byHash.set(identity.contentHash, updated);
      if (!alreadySourced) {
        duplicates.push({ path: file.sourcePath, id: updated.id, preExisting: true });
        deleteCandidates.push({
          absolutePath: file.absolutePath,
          sourcePath: file.sourcePath,
          contentHash: identity.contentHash,
          fileSize: statSync(file.absolutePath).size,
        });
      }
      continue;
    }

    if (existing) {
      const updated = withSourcePath(existing, file.sourcePath);
      cards = replaceCard(cards, updated);
      byHash.set(identity.contentHash, updated);
      duplicates.push({ path: file.sourcePath, id: updated.id, preExisting: false });
      continue;
    }

    const card = createResourceCard(root, file.absolutePath, options.now ?? new Date(), {
      writeAsset: !dryRun,
      category: options.category ?? categoryFromScanRoot(scanRootDir, file.absolutePath),
    });
    cards.push(card);
    if (card.contentHash) byHash.set(card.contentHash, card);
    imports.push({ path: file.sourcePath, id: card.id });
  }

  let deleted: DeleteResult[] = [];

  if (!dryRun) {
    writeAll(root, cards);
    renderOkfBundle(root, cards);
    if (deleteRequested) deleted = deleteCandidates.map((candidate) => safeDelete(candidate, options.beforeDelete));
  }

  return {
    scanned: files.length,
    imports,
    duplicates,
    wouldDelete: deleteCandidates.map((candidate) => candidate.sourcePath).sort(),
    deleted,
    dryRun,
    deleteRequested,
  };
}

export function renderOrganiseResult(result: OrganiseResult): string {
  const lines = [
    `resources organise${result.dryRun ? " (dry-run)" : ""}`,
    `scanned: ${result.scanned}`,
    `imports: ${result.imports.length}`,
    ...result.imports.map((item) => `- import ${item.path} -> ${item.id}`),
    `duplicates: ${result.duplicates.length}`,
    ...result.duplicates.map((item) => `- duplicate ${item.path} -> ${item.id}${item.preExisting ? " (pre-existing)" : " (same-run)"}`),
  ];

  if (result.deleteRequested && !result.dryRun) {
    lines.push(`deleted: ${result.deleted.filter((item) => item.deleted).length}`);
    for (const item of result.deleted) {
      lines.push(item.deleted ? `- deleted ${item.path}` : `- skipped ${item.path}: ${item.reason ?? "not deleted"}`);
    }
  } else {
    lines.push(`would-delete: ${result.wouldDelete.length}`);
    lines.push(...result.wouldDelete.map((path) => `- would delete ${path}`));
  }

  return lines.join("\n");
}
