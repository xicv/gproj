import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export interface SchemaSourceMatch {
  path: string;
  line: number;
  text: string;
}

export type SchemaSourceStatus = "resolved" | "missing-file" | "missing-symbol" | "ambiguous" | "invalid";

export interface SchemaSourceResolution {
  pointer: string;
  path: string;
  symbol: string;
  status: SchemaSourceStatus;
  matches: SchemaSourceMatch[];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parsePointer(pointer: string): { path: string; symbol: string } | null {
  const separator = pointer.lastIndexOf(":");
  if (separator <= 0 || separator === pointer.length - 1) return null;
  const path = pointer.slice(0, separator);
  const symbol = pointer.slice(separator + 1);
  if (!path || !symbol || isAbsolute(path)) return null;
  return { path, symbol };
}

function isInsideRoot(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function symbolPattern(symbol: string): RegExp {
  const prefix = String.raw`(?:export\s+)?(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?`;
  const declaration = String.raw`(?:class|function|const|let|interface|type|enum)`;
  return new RegExp(String.raw`^\s*${prefix}${declaration}\s+${escapeRegex(symbol)}\b`);
}

function scanSymbol(root: string, path: string, symbol: string): SchemaSourceMatch[] {
  const absolute = resolve(root, path);
  if (!isInsideRoot(root, absolute) || !existsSync(absolute)) return [];
  const pattern = symbolPattern(symbol);
  return readFileSync(absolute, "utf8")
    .split(/\n/)
    .flatMap((line, index) => {
      if (!pattern.test(line)) return [];
      return [{ path, line: index + 1, text: line.trim() }];
    });
}

export function resolveSchemaSource(root: string, pointer: string): SchemaSourceResolution {
  const parsed = parsePointer(pointer);
  if (!parsed) return { pointer, path: "", symbol: "", status: "invalid", matches: [] };

  const absolute = resolve(root, parsed.path);
  if (!isInsideRoot(root, absolute) || !existsSync(absolute)) {
    return { pointer, path: parsed.path, symbol: parsed.symbol, status: "missing-file", matches: [] };
  }

  const matches = scanSymbol(root, parsed.path, parsed.symbol);
  if (matches.length === 0) return { pointer, path: parsed.path, symbol: parsed.symbol, status: "missing-symbol", matches };
  if (matches.length > 1) return { pointer, path: parsed.path, symbol: parsed.symbol, status: "ambiguous", matches };
  return { pointer, path: parsed.path, symbol: parsed.symbol, status: "resolved", matches };
}

export function resolveSchemaSources(root: string, pointers: string[]): SchemaSourceResolution[] {
  return pointers.map((pointer) => resolveSchemaSource(root, pointer));
}
