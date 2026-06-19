import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";

export interface CodeIndex {
  symbols: Map<string, { path: string; line: number }>;
  endpoints: { label: string; path: string; line: number }[];
}

const skipDirs = new Set(["node_modules", ".git", "dist", "build", ".gproj", "coverage"]);
const textExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue"]);
const symbolDeclarationPattern = /\bexport\s+(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const symbolListPattern = /\bexport\s*\{\s*([^}]+)\}/g;
const httpRoutePattern = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[\w/:.\-{}]+)/g;
const callRoutePattern = /\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function codePath(root: string, path: string): string {
  return toPosix(relative(root, path));
}

function walk(root: string, dir: string, files: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) walk(root, path, files);
    } else if (entry.isFile() && textExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }
}

function addSymbol(index: CodeIndex, name: string, path: string, line: number): void {
  if (!index.symbols.has(name)) index.symbols.set(name, { path, line });
}

function exportNames(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .map((part) => part.replace(/\s+as\s+.+$/i, "").trim())
    .filter((part) => /^[A-Za-z_$][\w$]*$/.test(part));
}

function addEndpoint(index: CodeIndex, seen: Set<string>, label: string, path: string, line: number): void {
  if (seen.has(label)) return;
  seen.add(label);
  index.endpoints.push({ label, path, line });
}

function scanFile(index: CodeIndex, seenEndpoints: Set<string>, root: string, path: string): void {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return;
  }

  const rel = codePath(root, path);
  const lines = content.split(/\n/);
  for (const [lineIndex, line] of lines.entries()) {
    const lineNumber = lineIndex + 1;
    const declaration = symbolDeclarationPattern.exec(line);
    if (declaration) addSymbol(index, declaration[1], rel, lineNumber);

    for (const match of line.matchAll(symbolListPattern)) {
      for (const name of exportNames(match[1])) addSymbol(index, name, rel, lineNumber);
    }

    for (const match of line.matchAll(httpRoutePattern)) {
      const method = match[1].toUpperCase();
      const endpointPath = match[2];
      addEndpoint(index, seenEndpoints, `${method} ${endpointPath}`, endpointPath, lineNumber);
    }

    for (const match of line.matchAll(callRoutePattern)) {
      const method = match[1].toUpperCase();
      const endpointPath = match[2];
      addEndpoint(index, seenEndpoints, `${method} ${endpointPath}`, endpointPath, lineNumber);
    }
  }
}

export function buildCodeIndex(codeRoot: string): CodeIndex {
  const root = resolve(codeRoot);
  const index: CodeIndex = { symbols: new Map(), endpoints: [] };
  if (!existsSync(root)) return index;

  const files: string[] = [];
  walk(root, root, files);
  const seenEndpoints = new Set<string>();
  for (const file of files) scanFile(index, seenEndpoints, root, file);
  return index;
}
