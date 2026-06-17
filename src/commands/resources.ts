import { appendJournal } from "../format/journal.js";
import { ResourceCardSchema, type ResourceCard } from "../format/schema.js";
import { importResource } from "../resources/import.js";
import { add, getAll } from "../resources/manifest.js";
import { renderOkfBundle } from "../resources/okf.js";

function usage(): string {
  return "usage: gproj resources add <path> | list [--category <category>] | show <id>";
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

export function runResources(root: string, args: string[]): string {
  const [verb, ...rest] = args;
  switch (verb) {
    case "add":
      return addResource(root, rest);
    case "list":
      return listResources(root, rest);
    case "show":
      return showResource(root, rest);
    default:
      throw new Error(usage());
  }
}
