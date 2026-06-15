import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { StateSchema, type State } from "./schema.js";
import { filePath } from "./paths.js";

const ensureDir = (p: string) => mkdirSync(dirname(p), { recursive: true });

export function writeState(root: string, state: State): void {
  const p = filePath(root, "state.json");
  ensureDir(p);
  writeFileSync(p, JSON.stringify(StateSchema.parse(state), null, 2));
}
export function readState(root: string): State | null {
  const p = filePath(root, "state.json");
  if (!existsSync(p)) return null;
  return StateSchema.parse(JSON.parse(readFileSync(p, "utf8")));
}
export function appendNdjson(root: string, rel: string, record: unknown): void {
  const p = filePath(root, rel);
  ensureDir(p);
  appendFileSync(p, JSON.stringify(record) + "\n");
}
export function readNdjson(root: string, rel: string): unknown[] {
  const p = filePath(root, rel);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
export function writeMarkdown(root: string, rel: string, body: string): void {
  const p = filePath(root, rel);
  ensureDir(p);
  writeFileSync(p, body);
}
export function readMarkdown(root: string, rel: string): string | null {
  const p = filePath(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}
