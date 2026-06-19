import { createHash } from "node:crypto";
import type { ResourceCard } from "../format/schema.js";
import { buildCodeIndex, type CodeIndex } from "./codeIndex.js";
import { groundCard, rebaseGroundingPaths } from "./codeGround.js";
import { getAll } from "./manifest.js";
import { resolveSchemaSource, type SchemaSourceStatus } from "./schemaSource.js";
import { preferenceFor, readResolutions, type ConflictResolution } from "./resolutions.js";

export type ConflictKind = "dangling" | "mismatch" | "unconfirmed";

export interface DanglingConflict {
  pointer: string;
  status: SchemaSourceStatus;
}

export interface MismatchConflict {
  symbol: string;
  docPath: string;
  codePath: string;
}

export interface UnconfirmedAdditions {
  symbols: string[];
  endpoints: string[];
  schemaSource: string[];
}

export interface CardConflict {
  id: string;
  title: string;
  kinds: ConflictKind[];
  docSide: { symbols: string[]; endpoints: string[]; schemaSource: string[] };
  codeSide: { symbols: string[]; endpoints: string[]; schemaSource: string[] };
  dangling: DanglingConflict[];
  mismatch: MismatchConflict[];
  unconfirmed: UnconfirmedAdditions;
  fingerprint: string;
}

function splitPointer(pointer: string): { path: string; symbol: string } | null {
  const sep = pointer.lastIndexOf(":");
  if (sep <= 0 || sep === pointer.length - 1) return null;
  return { path: pointer.slice(0, sep), symbol: pointer.slice(sep + 1) };
}

function sorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function fingerprintOf(
  dangling: DanglingConflict[],
  mismatch: MismatchConflict[],
  unconfirmed: UnconfirmedAdditions,
): string {
  const payload = JSON.stringify({
    dangling: dangling.map((d) => `${d.pointer}|${d.status}`).sort(),
    mismatch: mismatch.map((m) => `${m.symbol}|${m.docPath}|${m.codePath}`).sort(),
    unconfirmed: {
      symbols: [...unconfirmed.symbols].sort(),
      endpoints: [...unconfirmed.endpoints].sort(),
      schemaSource: [...unconfirmed.schemaSource].sort(),
    },
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function conflictForCard(root: string, card: ResourceCard, index: CodeIndex, codeRoot: string): CardConflict | null {
  const docSymbols = sorted(card.owns?.symbols ?? []);
  const docEndpoints = sorted(card.owns?.endpoints ?? []);
  const docSchemaSource = sorted(card.schemaSource ?? []);
  const grounding = rebaseGroundingPaths(root, codeRoot, groundCard(card, index));
  const codeSymbols = grounding.symbols;
  const codeEndpoints = grounding.endpoints;
  const codeSchemaSource = grounding.schemaSource;

  // dangling: doc pointers that no longer resolve against the code.
  const dangling: DanglingConflict[] = [];
  for (const pointer of docSchemaSource) {
    const status = resolveSchemaSource(root, pointer).status;
    if (status !== "resolved") dangling.push({ pointer, status });
  }

  // mismatch: same symbol, different path between doc and code schemaSource.
  const codePathBySymbol = new Map<string, string>();
  for (const pointer of codeSchemaSource) {
    const parsed = splitPointer(pointer);
    if (parsed) codePathBySymbol.set(parsed.symbol, parsed.path);
  }
  const mismatch: MismatchConflict[] = [];
  for (const pointer of docSchemaSource) {
    const parsed = splitPointer(pointer);
    if (!parsed) continue;
    const codePath = codePathBySymbol.get(parsed.symbol);
    if (codePath !== undefined && codePath !== parsed.path) {
      mismatch.push({ symbol: parsed.symbol, docPath: parsed.path, codePath });
    }
  }

  // unconfirmed: code additions the card does not already claim (and not part of a mismatch).
  const docSchemaSet = new Set(docSchemaSource);
  const mismatchSymbols = new Set(mismatch.map((m) => m.symbol));
  const unconfirmed: UnconfirmedAdditions = {
    symbols: codeSymbols.filter((s) => !docSymbols.includes(s)),
    endpoints: codeEndpoints.filter((e) => !docEndpoints.includes(e)),
    schemaSource: codeSchemaSource.filter((s) => {
      if (docSchemaSet.has(s)) return false;
      const parsed = splitPointer(s);
      return !(parsed && mismatchSymbols.has(parsed.symbol));
    }),
  };

  const kinds: ConflictKind[] = [];
  if (dangling.length > 0) kinds.push("dangling");
  if (mismatch.length > 0) kinds.push("mismatch");
  if (
    unconfirmed.symbols.length > 0 ||
    unconfirmed.endpoints.length > 0 ||
    unconfirmed.schemaSource.length > 0
  ) {
    kinds.push("unconfirmed");
  }
  if (kinds.length === 0) return null;

  return {
    id: card.id,
    title: card.title,
    kinds,
    docSide: { symbols: docSymbols, endpoints: docEndpoints, schemaSource: docSchemaSource },
    codeSide: { symbols: codeSymbols, endpoints: codeEndpoints, schemaSource: codeSchemaSource },
    dangling,
    mismatch,
    unconfirmed,
    fingerprint: fingerprintOf(dangling, mismatch, unconfirmed),
  };
}

export interface ConflictsResult {
  codeRoot: string;
  index: CodeIndex;
  conflicts: CardConflict[];
  resolved: number;
}

export function detectConflicts(
  root: string,
  codeRoot: string,
  resolutions: ConflictResolution[] = readResolutions(root),
): ConflictsResult {
  const index = buildCodeIndex(codeRoot);
  const cards = getAll(root);
  const conflicts: CardConflict[] = [];
  let resolved = 0;
  for (const card of cards) {
    const conflict = conflictForCard(root, card, index, codeRoot);
    if (!conflict) continue;
    if (preferenceFor(resolutions, conflict.id, conflict.fingerprint) !== undefined) {
      resolved += 1;
      continue;
    }
    conflicts.push(conflict);
  }
  conflicts.sort((a, b) => a.id.localeCompare(b.id));
  return { codeRoot, index, conflicts, resolved };
}

function list(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

export function renderConflictsReport(result: ConflictsResult): string {
  const lines: string[] = [
    "# Resource conflicts",
    "",
    `code root: ${result.codeRoot}`,
    `conflicts: ${result.conflicts.length}`,
    `resolved (honored): ${result.resolved}`,
    "",
  ];
  if (result.conflicts.length === 0) {
    lines.push("No unresolved conflicts.");
    return lines.join("\n") + "\n";
  }
  for (const c of result.conflicts) {
    lines.push(`## ${c.id} — ${c.title}`);
    lines.push(`- kinds: ${c.kinds.join(", ")}`);
    lines.push(
      `- doc-side: symbols=[${list(c.docSide.symbols)}] endpoints=[${list(c.docSide.endpoints)}] schemaSource=[${list(c.docSide.schemaSource)}]`,
    );
    lines.push(
      `- code-side: symbols=[${list(c.codeSide.symbols)}] endpoints=[${list(c.codeSide.endpoints)}] schemaSource=[${list(c.codeSide.schemaSource)}]`,
    );
    for (const d of c.dangling) lines.push(`- dangling: ${d.pointer} (${d.status})`);
    for (const m of c.mismatch) lines.push(`- mismatch: ${m.symbol} doc=${m.docPath} code=${m.codePath}`);
    if (c.unconfirmed.symbols.length > 0) lines.push(`- unconfirmed symbols: ${list(c.unconfirmed.symbols)}`);
    if (c.unconfirmed.endpoints.length > 0) lines.push(`- unconfirmed endpoints: ${list(c.unconfirmed.endpoints)}`);
    if (c.unconfirmed.schemaSource.length > 0) lines.push(`- unconfirmed schemaSource: ${list(c.unconfirmed.schemaSource)}`);
    lines.push(`- resolve: gproj resources resolve ${c.id} --prefer code|doc`);
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

// Apply the code side to a card: add unconfirmed additions, drop dangling pointers,
// rewrite mismatched pointers to the code path. Returns a new card (caller validates).
export function applyCodeSide(card: ResourceCard, conflict: CardConflict): ResourceCard {
  const danglingSet = new Set(conflict.dangling.map((d) => d.pointer));
  const mismatchByDocPointer = new Map(
    conflict.mismatch.map((m) => [`${m.docPath}:${m.symbol}`, `${m.codePath}:${m.symbol}`]),
  );

  const symbols = sorted([...(card.owns?.symbols ?? []), ...conflict.unconfirmed.symbols]);
  const endpoints = sorted([...(card.owns?.endpoints ?? []), ...conflict.unconfirmed.endpoints]);
  const configKeys = sorted(card.owns?.configKeys ?? []);

  const rewritten = (card.schemaSource ?? []).flatMap((p) => {
    const fixed = mismatchByDocPointer.get(p);
    if (fixed) return [fixed];
    if (danglingSet.has(p)) return [];
    return [p];
  });
  const schemaSource = sorted([...rewritten, ...conflict.unconfirmed.schemaSource]);

  return {
    ...card,
    owns:
      symbols.length > 0 || endpoints.length > 0 || configKeys.length > 0
        ? { symbols, endpoints, configKeys }
        : undefined,
    schemaSource: schemaSource.length > 0 ? schemaSource : undefined,
  };
}
