import type { ResourceCard } from "../format/schema.js";
import type { CodeIndex } from "./codeIndex.js";

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
