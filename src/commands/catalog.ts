import { parseArgs } from "node:util";
import { catalogEntries, rankCatalogEntries, renderCatalogJson, renderCatalogText } from "../catalog.js";

function usage(): string {
  return "usage: gproj catalog [--json] [--intent <text>]";
}

export function runCatalog(args: string[]): string {
  const parsed = parseArgs({
    args,
    allowPositionals: false,
    options: {
      json: { type: "boolean", default: false },
      intent: { type: "string" },
    },
  });
  const intent = typeof parsed.values.intent === "string" ? parsed.values.intent.trim() : undefined;
  if (intent !== undefined && intent.length === 0) throw new Error(usage());

  const matches = intent ? rankCatalogEntries(intent) : catalogEntries;
  const entries = intent && matches.length === 0 ? catalogEntries : matches;
  if (parsed.values.json === true) return renderCatalogJson(entries);

  const note = intent && matches.length === 0
    ? `No catalog entries matched intent "${intent}"; showing the full catalog.`
    : undefined;
  return renderCatalogText(entries, note);
}
