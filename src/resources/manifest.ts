import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { ResourceCardSchema, type ResourceCard } from "../format/schema.js";
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

export function writeAll(root: string, cards: ResourceCard[]): void {
  const path = resourcesManifestPath(root);
  const validated = cards.map((card, index) => {
    const parsed = ResourceCardSchema.safeParse(card);
    if (!parsed.success) {
      throw new Error(`resource card ${index + 1}: invalid ResourceCard: ${formatIssues(parsed.error)}`);
    }
    return parsed.data;
  });

  const data = validated.map((card) => JSON.stringify(card)).join("\n") + (validated.length > 0 ? "\n" : "");
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
  writeAll(root, [...getAll(root), parsed]);
  return parsed;
}
