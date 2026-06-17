import { existsSync, unlinkSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";
import { parseArgs } from "node:util";
import { appendJournal } from "../format/journal.js";
import { resourcesBundleDir } from "../format/paths.js";
import { ResourceCardSchema, type ResourceCard } from "../format/schema.js";
import { renderResourceDoctor } from "../resources/doctor.js";
import { importResource } from "../resources/import.js";
import { add, getAll, linkCards, removeCard, writeAll } from "../resources/manifest.js";
import { organiseResources, renderOrganiseResult } from "../resources/organise.js";
import { renderOkfBundle } from "../resources/okf.js";

function usage(): string {
  return "usage: gproj resources add <path> | organise [--dry-run] [--delete] [dir] | list [--category <category>] | show <id> | find <query> | link <fromId> <rel> <toId> | rm <id> | doctor";
}

function parseCategory(args: string[]): string | undefined {
  if (args.length === 0) return undefined;
  if (args.length === 1 && args[0]?.startsWith("--category=")) return args[0].slice("--category=".length);
  if (args.length === 2 && args[0] === "--category") return args[1];
  throw new Error(usage());
}

function renderSummary(card: ResourceCard): string {
  return `${card.id}\t${card.category}\t${card.type}\t${card.title}`;
}

function addResource(root: string, args: string[]): string {
  if (args.length !== 1) throw new Error(usage());
  const card = add(root, importResource(root, args[0]));
  renderOkfBundle(root, getAll(root));
  appendJournal(root, { phase: 0, event: "resource-added", status: "added", detail: card.id });
  return `resource added: ${card.id}`;
}

function listResources(root: string, args: string[]): string {
  const category = parseCategory(args);
  const cards = getAll(root).filter((card) => category === undefined || card.category === category);
  if (cards.length === 0) return "resources: none";
  return cards.map(renderSummary).join("\n");
}

function showResource(root: string, args: string[]): string {
  if (args.length !== 1) throw new Error(usage());
  const id = args[0];
  const card = getAll(root).find((candidate) => candidate.id === id);
  if (!card) throw new Error(`resource not found: ${id}`);
  return JSON.stringify(ResourceCardSchema.parse(card), null, 2);
}

function findResources(root: string, args: string[]): string {
  if (args.length !== 1) throw new Error(usage());
  const query = args[0].toLowerCase();
  const matches = getAll(root).filter((card) => {
    const haystack = [
      card.id,
      card.type,
      card.title,
      card.category,
      ...(card.tags ?? []),
      ...(card.sourcePaths ?? []),
      card.excerpt ?? "",
      card.description ?? "",
    ].join("\n").toLowerCase();
    return haystack.includes(query);
  });
  if (matches.length === 0) return "resources: none";
  return matches.map(renderSummary).join("\n");
}

function parseOrganiseArgs(args: string[]): { dir: string; dryRun: boolean; deleteDuplicates: boolean } {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      delete: { type: "boolean", default: false },
    },
  });
  if (parsed.positionals.length > 1) throw new Error(usage());
  return {
    dir: parsed.positionals[0] ?? ".",
    dryRun: parsed.values["dry-run"] === true,
    deleteDuplicates: parsed.values.delete === true,
  };
}

function organise(root: string, args: string[]): string {
  const options = parseOrganiseArgs(args);
  const result = organiseResources(root, options.dir, {
    dryRun: options.dryRun,
    deleteDuplicates: options.deleteDuplicates,
  });
  if (!options.dryRun) appendJournal(root, { phase: 0, event: "resources-organised", status: "ok", detail: `imports=${result.imports.length}; duplicates=${result.duplicates.length}` });
  return renderOrganiseResult(result);
}

function linkResource(root: string, args: string[]): string {
  if (args.length !== 3) throw new Error(usage());
  const [fromId, rel, toId] = args;
  const cards = linkCards(getAll(root), fromId, rel, toId);
  writeAll(root, cards);
  renderOkfBundle(root, cards);
  appendJournal(root, { phase: 0, event: "resource-linked", status: "linked", detail: `${fromId} ${rel} ${toId}` });
  return `resource linked: ${fromId} ${rel} ${toId}`;
}

function assetPath(root: string, resource: string): string | null {
  if (!resource.startsWith("_assets/")) return null;
  const normalized = normalize(resource).split(sep).join("/");
  if (!normalized.startsWith("_assets/") || normalized.startsWith("..") || isAbsolute(normalized)) return null;
  return join(resourcesBundleDir(root), normalized);
}

function removeUnusedAsset(root: string, removed: ResourceCard, remaining: ResourceCard[]): boolean {
  if (!removed.resource) return false;
  if (remaining.some((card) => card.resource === removed.resource)) return false;
  const path = assetPath(root, removed.resource);
  if (!path || !existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

function removeResource(root: string, args: string[]): string {
  if (args.length !== 1) throw new Error(usage());
  const result = removeCard(getAll(root), args[0]);
  writeAll(root, result.cards);
  renderOkfBundle(root, result.cards);
  const assetRemoved = removeUnusedAsset(root, result.removed, result.cards);
  appendJournal(root, { phase: 0, event: "resource-removed", status: "removed", detail: result.removed.id });
  return [
    `resource removed: ${result.removed.id}`,
    `inbound links removed: ${result.removedLinks}`,
    `asset removed: ${assetRemoved ? "yes" : "no"}`,
  ].join("\n");
}

export function runResources(root: string, args: string[]): string {
  const [verb, ...rest] = args;
  switch (verb) {
    case "add":
      return addResource(root, rest);
    case "organise":
      return organise(root, rest);
    case "list":
      return listResources(root, rest);
    case "show":
      return showResource(root, rest);
    case "find":
      return findResources(root, rest);
    case "link":
      return linkResource(root, rest);
    case "rm":
      return removeResource(root, rest);
    case "doctor":
      if (rest.length !== 0) throw new Error(usage());
      return renderResourceDoctor(root);
    default:
      throw new Error(usage());
  }
}

export function isResourcesMutation(args: string[]): boolean {
  const [verb, ...rest] = args;
  if (verb === "add" || verb === "link" || verb === "rm") return true;
  if (verb !== "organise") return false;
  try {
    return !parseOrganiseArgs(rest).dryRun;
  } catch {
    return false;
  }
}
