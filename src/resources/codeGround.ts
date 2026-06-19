import type { ResourceCard } from "../format/schema.js";
import type { CodeIndex } from "./codeIndex.js";
import { relative, resolve, sep } from "node:path";

export interface Grounding {
  symbols: string[];
  endpoints: string[];
  schemaSource: string[];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isGroundableSymbol(name: string): boolean {
  return /[A-Z_]/.test(name);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function groundCard(card: ResourceCard, index: CodeIndex): Grounding {
  const text = [card.title, card.excerpt ?? "", card.body ?? ""].join("\n");
  const symbols: string[] = [];
  const endpoints: string[] = [];
  const schemaSource: string[] = [];

  for (const [name, source] of index.symbols) {
    if (!isGroundableSymbol(name)) continue;
    if (!new RegExp(String.raw`\b${escapeRegex(name)}\b`).test(text)) continue;
    symbols.push(name);
    schemaSource.push(`${source.path}:${name}`);
  }

  for (const endpoint of index.endpoints) {
    if (text.includes(endpoint.path)) endpoints.push(endpoint.label);
  }

  return {
    symbols: uniqueSorted(symbols),
    endpoints: uniqueSorted(endpoints),
    schemaSource: uniqueSorted(schemaSource),
  };
}

// Rebase a grounding's schemaSource pointers (emitted relative to the code index's
// codeRoot) to be relative to the project root, so stored pointers stay consistent with
// resolveSchemaSource (which resolves against root) regardless of the --code-root used.
export function rebaseGroundingPaths(root: string, codeRoot: string, grounding: Grounding): Grounding {
  return {
    symbols: grounding.symbols,
    endpoints: grounding.endpoints,
    schemaSource: grounding.schemaSource.map((pointer) => {
      const separator = pointer.lastIndexOf(":");
      if (separator <= 0 || separator === pointer.length - 1) return pointer;
      const path = pointer.slice(0, separator);
      const symbol = pointer.slice(separator + 1);
      return `${relative(root, resolve(codeRoot, path)).split(sep).join("/")}:${symbol}`;
    }),
  };
}
