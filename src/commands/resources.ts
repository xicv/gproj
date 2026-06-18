import { existsSync, unlinkSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";
import { parseArgs } from "node:util";
import { getPlannerBackend, PlannerUnavailableError, type PlannerBackend } from "../backends/planner.js";
import { appendJournal } from "../format/journal.js";
import { resourcesBundleDir } from "../format/paths.js";
import {
  ResourceCardSchema,
  ResourceRelationSchema,
  type ResourceCard,
  type ResourceLink,
  type ResourceOwns,
} from "../format/schema.js";
import { renderResourceDoctor } from "../resources/doctor.js";
import { enrichResources, renderEnrichResult } from "../resources/enrich.js";
import { importResource } from "../resources/import.js";
import { add, getAll, linkCards, removeCard, writeAll } from "../resources/manifest.js";
import { auditCards, type AuditReport } from "../resources/audit.js";
import { evalRetrieval, generateEvalSet, readEvalSetFile, renderRetrievalEvalReport, writeEvalSet } from "../resources/eval.js";
import { rankFind, type RankedResource } from "../resources/find.js";
import { judgeLinks, renderJudgeReport } from "../resources/judge.js";
import { organiseResources, renderOrganiseResult } from "../resources/organise.js";
import { buildOkfIndex, readOkfIndex, renderOkfBundle, writeOkfIndex } from "../resources/okf.js";
import { resolveSchemaSource, type SchemaSourceResolution } from "../resources/schemaSource.js";
import { captureSession, renderCaptureResult } from "../resources/capture/capture.js";
import { finalizePendingCapture } from "../resources/capture/finalize.js";
import { installStopHook } from "../resources/capture/hook.js";
import { discardPendingCapture, listPendingCaptures } from "../resources/capture/pending.js";

function usage(): string {
  return "usage: gproj resources add [--category <category>] [--title <title>] [--type <type>] [--tags <a,b,c>] [--link <rel>:<toId>] [--intent <intent>] [--owns-symbol <symbol>] [--owns-endpoint <endpoint>] [--owns-config <key>] [--schema-source <path:Symbol>] <path> | organise [--dry-run] [--delete] [--category <category>] [dir] | enrich [--category <category>] [--limit <n>] [--batch-size <n>] [--dry-run] [--reenrich] | audit [--json] [--judge] [--sample <n>] | eval <evalset.json> [--json] | eval --generate [--out <file>] | list [--category <category>] | show <id> | find [--limit <n>|--all] <query> | schema <id> | index | link <fromId> <rel> <toId> | rm <id> | doctor | capture [--auto] --session <id> | capture list | capture finalize <id> [--share] [--add|--refine <id>] | capture discard <id> | capture install-hook [--global|--project] [--uninstall]";
}

export interface ResourcesDeps {
  planner?: PlannerBackend;
  plannerName?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  now?: Date;
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

function renderAuditMetric(label: string, metric: { count: number; percentage: number }): string {
  return `${label}: ${metric.count} (${metric.percentage}%)`;
}

function renderAuditReport(report: AuditReport): string {
  const categories = Object.entries(report.distribution.categoryHistogram)
    .slice(0, 10)
    .map(([category, count]) => `${category}:${count}`)
    .join(", ") || "none";
  const tags = report.distribution.topTags
    .slice(0, 10)
    .map((entry) => `${entry.tag}:${entry.count}`)
    .join(", ") || "none";
  const hubs = report.connectivity.hubs
    .filter((hub) => hub.degree > 0)
    .map((hub) => `${hub.id}:${hub.degree}`)
    .join(", ") || "none";
  return [
    `resources audit: healthScore ${report.healthScore}/100`,
    "coverage:",
    `  total: ${report.coverage.total}`,
    `  ${renderAuditMetric("enrichedAt", report.coverage.enrichedAt)}`,
    `  ${renderAuditMetric("linked", report.coverage.linked)}`,
    `  ${renderAuditMetric("tagged", report.coverage.tagged)}`,
    `  ${renderAuditMetric("intent", report.coverage.intent)}`,
    `  ${renderAuditMetric("owns", report.coverage.owns)}`,
    `  ${renderAuditMetric("schemaSource", report.coverage.schemaSource)}`,
    "connectivity:",
    `  orphans: ${report.connectivity.orphans.length}`,
    `  components: ${report.connectivity.componentCount}`,
    `  largest component: ${report.connectivity.largestComponentSize} (${report.connectivity.largestComponentPct}%)`,
    `  avg degree: ${report.connectivity.avgDegree}`,
    `  max degree: ${report.connectivity.maxDegree}`,
    `  density: ${report.connectivity.density}`,
    `  hubs: ${hubs}`,
    "integrity:",
    `  dangling links: ${report.integrity.danglingLinks.count}`,
    `  self links: ${report.integrity.selfLinks}`,
    `  duplicate links: ${report.integrity.duplicateLinks}`,
    "distribution:",
    `  top categories: ${categories}`,
    `  top tags: ${tags}`,
    `flags: ${report.flags.length > 0 ? report.flags.join("; ") : "none"}`,
  ].join("\n");
}

interface AddArgs {
  path: string;
  category?: string;
  title?: string;
  type?: string;
  tags?: string[];
  links?: ResourceLink[];
  intent?: string;
  owns?: ResourceOwns;
  schemaSource?: string[];
}

function normalizeTags(value: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of value.split(",")) {
    const tag = raw.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

function parseLink(value: string): ResourceLink {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`invalid --link value: ${value}; expected <rel>:<toId>`);
  }
  const rel = value.slice(0, separator).trim();
  const toId = value.slice(separator + 1).trim();
  if (!rel || !toId) throw new Error(`invalid --link value: ${value}; expected <rel>:<toId>`);
  const parsed = ResourceRelationSchema.safeParse(rel);
  if (!parsed.success) throw new Error(`invalid relation type: ${rel}`);
  return { rel: parsed.data, toId };
}

function stringValues(value: string | boolean | string[] | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [value];
  throw new Error(usage());
}

function optionalString(value: string | boolean | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(usage());
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function ownsFromArgs(symbols: string[], endpoints: string[], configKeys: string[]): ResourceOwns | undefined {
  if (symbols.length === 0 && endpoints.length === 0 && configKeys.length === 0) return undefined;
  return { symbols, endpoints, configKeys };
}

function parseAddArgs(args: string[]): AddArgs {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      category: { type: "string" },
      title: { type: "string" },
      type: { type: "string" },
      tags: { type: "string" },
      link: { type: "string", multiple: true },
      intent: { type: "string" },
      "owns-symbol": { type: "string", multiple: true },
      "owns-endpoint": { type: "string", multiple: true },
      "owns-config": { type: "string", multiple: true },
      "schema-source": { type: "string", multiple: true },
    },
  });
  if (parsed.positionals.length !== 1) throw new Error(usage());
  const tags = typeof parsed.values.tags === "string" ? normalizeTags(parsed.values.tags) : undefined;
  const links = stringValues(parsed.values.link).map(parseLink);
  const ownsSymbols = stringValues(parsed.values["owns-symbol"]);
  const ownsEndpoints = stringValues(parsed.values["owns-endpoint"]);
  const ownsConfigKeys = stringValues(parsed.values["owns-config"]);
  const schemaSource = stringValues(parsed.values["schema-source"]);
  return {
    path: parsed.positionals[0],
    category: typeof parsed.values.category === "string" ? parsed.values.category : undefined,
    title: typeof parsed.values.title === "string" ? parsed.values.title : undefined,
    type: typeof parsed.values.type === "string" ? parsed.values.type : undefined,
    tags,
    links: links.length > 0 ? links : undefined,
    intent: optionalString(parsed.values.intent),
    owns: ownsFromArgs(ownsSymbols, ownsEndpoints, ownsConfigKeys),
    schemaSource: schemaSource.length > 0 ? schemaSource : undefined,
  };
}

function addResource(root: string, args: string[]): string {
  const options = parseAddArgs(args);
  const card = add(root, importResource(root, options.path, new Date(), {
    category: options.category,
    title: options.title,
    type: options.type,
    tags: options.tags,
    links: options.links,
    intent: options.intent,
    owns: options.owns,
    schemaSource: options.schemaSource,
  }));
  renderOkfBundle(root, getAll(root));
  appendJournal(root, { phase: 0, event: "resource-added", status: "added", detail: card.id });
  return `resource added: ${card.id}`;
}

async function auditResources(root: string, args: string[], deps: ResourcesDeps): Promise<string> {
  const parsed = parseArgs({
    args,
    allowPositionals: false,
    options: {
      json: { type: "boolean", default: false },
      judge: { type: "boolean", default: false },
      sample: { type: "string" },
    },
  });
  const report = auditCards(getAll(root));
  const sample = parsePositiveInteger(typeof parsed.values.sample === "string" ? parsed.values.sample : undefined, "--sample") ?? 20;
  if (parsed.values.judge !== true) return parsed.values.json === true ? JSON.stringify(report, null, 2) : renderAuditReport(report);
  const judge = await judgeLinks(root, { planner: plannerForFinalize(root, deps), sample });
  if (parsed.values.json === true) return JSON.stringify({ audit: report, judge }, null, 2);
  return [renderAuditReport(report), "", renderJudgeReport(judge)].join("\n");
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

function renderFindResult(match: RankedResource): string {
  const entry = match.entry;
  return `${entry.id}\t${entry.category}\t${entry.type}\t${entry.title}\tmatch=${match.reason}\tfield=${match.field}`;
}

const defaultFindLimit = 20;

function parsePositiveInteger(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${flag} must be a positive integer`);
  return Number(value);
}

function parseFindArgs(args: string[]): { query: string; limit: number | null } {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      limit: { type: "string" },
      all: { type: "boolean", default: false },
    },
  });
  if (parsed.positionals.length !== 1) throw new Error(usage());
  const query = parsed.positionals[0].trim();
  if (!query) throw new Error(usage());
  const all = parsed.values.all === true;
  return {
    query,
    limit: all ? null : parsePositiveInteger(typeof parsed.values.limit === "string" ? parsed.values.limit : undefined, "--limit") ?? defaultFindLimit,
  };
}

function findResources(root: string, args: string[]): string {
  const { query, limit } = parseFindArgs(args);
  const cards = getAll(root);
  const entries = readOkfIndex(root) ?? buildOkfIndex(cards);
  const matches = rankFind(cards, query, entries);
  if (matches.length === 0) return "resources: none";
  const capped = limit === null ? matches : matches.slice(0, limit);
  return capped.map(renderFindResult).join("\n");
}

function renderSchemaResolution(resolution: SchemaSourceResolution): string {
  switch (resolution.status) {
    case "resolved": {
      const match = resolution.matches[0];
      return `${match.path}:${match.line}\t${resolution.symbol}`;
    }
    case "missing-file":
      return `warning: ${resolution.pointer}: missing file`;
    case "missing-symbol":
      return `warning: ${resolution.pointer}: missing symbol`;
    case "ambiguous":
      return `warning: ${resolution.pointer}: ambiguous match (${resolution.matches.length})`;
    case "invalid":
      return `warning: ${resolution.pointer}: invalid schemaSource`;
  }
}

function schemaResource(root: string, args: string[]): string {
  if (args.length !== 1) throw new Error(usage());
  const id = args[0];
  const card = getAll(root).find((candidate) => candidate.id === id);
  if (!card) throw new Error(`resource not found: ${id}`);
  const sources = card.schemaSource ?? [];
  if (sources.length === 0) return "resource schema: none";
  return sources.map((source) => resolveSchemaSource(root, source)).map(renderSchemaResolution).join("\n");
}

function indexResources(root: string, args: string[]): string {
  if (args.length !== 0) throw new Error(usage());
  writeOkfIndex(root, getAll(root));
  return ".gproj/resources/.okf-index.json";
}

function parseOrganiseArgs(args: string[]): { dir: string; dryRun: boolean; deleteDuplicates: boolean; category?: string } {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      delete: { type: "boolean", default: false },
      category: { type: "string" },
    },
  });
  if (parsed.positionals.length > 1) throw new Error(usage());
  return {
    dir: parsed.positionals[0] ?? ".",
    dryRun: parsed.values["dry-run"] === true,
    deleteDuplicates: parsed.values.delete === true,
    category: typeof parsed.values.category === "string" ? parsed.values.category : undefined,
  };
}

function organise(root: string, args: string[]): string {
  const options = parseOrganiseArgs(args);
  const result = organiseResources(root, options.dir, {
    dryRun: options.dryRun,
    deleteDuplicates: options.deleteDuplicates,
    category: options.category,
  });
  if (!options.dryRun) appendJournal(root, { phase: 0, event: "resources-organised", status: "ok", detail: `imports=${result.imports.length}; duplicates=${result.duplicates.length}` });
  return renderOrganiseResult(result);
}

function parseEnrichBatchSize(value: string | boolean | string[] | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(usage());
  try {
    return parsePositiveInteger(value, "--batch-size");
  } catch {
    throw new Error(usage());
  }
}

function parseEnrichArgs(args: string[]): { category?: string; limit?: number; batchSize?: number; dryRun: boolean; reenrich: boolean } {
  const parsed = parseArgs({
    args,
    allowPositionals: false,
    options: {
      category: { type: "string" },
      limit: { type: "string" },
      "batch-size": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      reenrich: { type: "boolean", default: false },
    },
  });
  return {
    category: typeof parsed.values.category === "string" ? parsed.values.category : undefined,
    limit: parsePositiveInteger(typeof parsed.values.limit === "string" ? parsed.values.limit : undefined, "--limit"),
    batchSize: parseEnrichBatchSize(parsed.values["batch-size"]),
    dryRun: parsed.values["dry-run"] === true,
    reenrich: parsed.values.reenrich === true,
  };
}

async function enrich(root: string, args: string[], deps: ResourcesDeps): Promise<string> {
  const options = parseEnrichArgs(args);
  const result = await enrichResources(root, {
    planner: plannerForFinalize(root, deps),
    category: options.category,
    limit: options.limit,
    batchSize: options.batchSize,
    dryRun: options.dryRun,
    reenrich: options.reenrich,
    now: deps.now,
  });
  const output = renderEnrichResult(result);
  if (!result.summary.halted) return output;
  const pending = Math.max(0, result.summary.selected - result.summary.enriched);
  return [
    output,
    `Planner unavailable (ChatGPT Pro limit / model unavailable). Enriched ${result.summary.enriched}; ${pending} pending — nothing lost. Re-run \`gproj resources enrich\` later, or use GPROJ_PLANNER=openai-responses.`,
  ].join("\n");
}

async function evalResources(root: string, args: string[], deps: ResourcesDeps): Promise<string> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      generate: { type: "boolean", default: false },
      out: { type: "string" },
      k: { type: "string" },
    },
  });
  const generate = parsed.values.generate === true;
  const out = typeof parsed.values.out === "string" ? parsed.values.out : undefined;
  const k = parsePositiveInteger(typeof parsed.values.k === "string" ? parsed.values.k : undefined, "--k") ?? 10;

  if (generate) {
    if (parsed.positionals.length !== 0) throw new Error(usage());
    try {
      const evalset = await generateEvalSet(root, { planner: plannerForFinalize(root, deps) });
      if (out) {
        writeEvalSet(out, evalset);
        return `evalset written: ${out}`;
      }
      return JSON.stringify(evalset, null, 2);
    } catch (error) {
      if (error instanceof PlannerUnavailableError) {
        return `Planner unavailable (ChatGPT Pro limit / model unavailable). No evalset generated; re-run \`gproj resources eval --generate${out ? ` --out ${out}` : ""}\` later, or use GPROJ_PLANNER=openai-responses.`;
      }
      throw error;
    }
  }

  if (out !== undefined || parsed.positionals.length !== 1) throw new Error(usage());
  const evalset = readEvalSetFile(parsed.positionals[0]);
  const report = evalRetrieval(root, evalset, { k });
  return parsed.values.json === true ? JSON.stringify(report, null, 2) : renderRetrievalEvalReport(report);
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

function homeFromDeps(deps: ResourcesDeps): string | undefined {
  return deps.home ?? deps.env?.HOME;
}

function sessionFromValue(value: string | boolean | string[] | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function captureNow(deps: ResourcesDeps): Date | undefined {
  return deps.now;
}

function runCaptureCreate(root: string, args: string[], deps: ResourcesDeps): string {
  const parsed = parseArgs({
    args,
    allowPositionals: false,
    options: {
      auto: { type: "boolean", default: false },
      session: { type: "string" },
    },
  });
  const auto = parsed.values.auto === true;
  const sessionId = sessionFromValue(parsed.values.session) ?? sessionFromValue(deps.env?.CLAUDE_SESSION_ID);
  const result = captureSession(root, {
    auto,
    sessionId,
    home: homeFromDeps(deps),
    now: captureNow(deps),
    cwd: root,
  });
  return auto ? "" : renderCaptureResult(result);
}

function renderCaptureList(root: string): string {
  const pending = listPendingCaptures(root);
  if (pending.length === 0) return "captures: none";
  return pending
    .map((capture) => `${capture.id}\t${capture.classification}\t${capture.capturedAt}\t${capture.digest.toolSequence.length} tools`)
    .join("\n");
}

function plannerForFinalize(root: string, deps: ResourcesDeps): PlannerBackend {
  if (deps.planner) return deps.planner;
  return getPlannerBackend(deps.plannerName ?? deps.env?.GPROJ_PLANNER ?? "oracle-browser", root);
}

async function runCaptureFinalize(root: string, args: string[], deps: ResourcesDeps): Promise<string> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      share: { type: "boolean", default: false },
      add: { type: "boolean", default: false },
      refine: { type: "string" },
    },
  });
  if (parsed.positionals.length !== 1) throw new Error(usage());
  const addDecision = parsed.values.add === true;
  const refineId = typeof parsed.values.refine === "string" ? parsed.values.refine : undefined;
  if (addDecision && refineId) throw new Error("capture finalize accepts only one of --add or --refine");
  const result = await finalizePendingCapture(root, parsed.positionals[0], {
    planner: plannerForFinalize(root, deps),
    share: parsed.values.share === true,
    decision: refineId ? "refine" : addDecision ? "add" : undefined,
    refineId,
    now: deps.now,
  });
  appendJournal(root, { phase: 0, event: "capture-finalized", status: result.action, detail: result.card.id });
  return `capture finalized: ${result.card.id} (${result.action})`;
}

function runCaptureDiscard(root: string, args: string[]): string {
  if (args.length !== 1) throw new Error(usage());
  const pending = discardPendingCapture(root, args[0]);
  appendJournal(root, { phase: 0, event: "capture-discarded", status: "discarded", detail: pending.id });
  return `capture discarded: ${pending.id}`;
}

function runCaptureInstallHook(root: string, args: string[], deps: ResourcesDeps): string {
  const parsed = parseArgs({
    args,
    allowPositionals: false,
    options: {
      global: { type: "boolean", default: false },
      project: { type: "boolean", default: false },
      uninstall: { type: "boolean", default: false },
    },
  });
  if (parsed.values.global === true && parsed.values.project === true) throw new Error(usage());
  return installStopHook({
    home: homeFromDeps(deps),
    root,
    scope: parsed.values.project === true ? "project" : "global",
    uninstall: parsed.values.uninstall === true,
  });
}

async function runCapture(root: string, args: string[], deps: ResourcesDeps): Promise<string> {
  const [verb, ...rest] = args;
  switch (verb) {
    case undefined:
      return runCaptureCreate(root, [], deps);
    case "list":
      if (rest.length !== 0) throw new Error(usage());
      return renderCaptureList(root);
    case "finalize":
      return runCaptureFinalize(root, rest, deps);
    case "discard":
      return runCaptureDiscard(root, rest);
    case "install-hook":
      return runCaptureInstallHook(root, rest, deps);
    default:
      if (verb.startsWith("--")) return runCaptureCreate(root, args, deps);
      throw new Error(usage());
  }
}

export async function runResources(root: string, args: string[], deps: ResourcesDeps = {}): Promise<string> {
  const [verb, ...rest] = args;
  switch (verb) {
    case "add":
      return addResource(root, rest);
    case "organise":
      return organise(root, rest);
    case "enrich":
      return enrich(root, rest, deps);
    case "audit":
      return auditResources(root, rest, deps);
    case "eval":
      return evalResources(root, rest, deps);
    case "list":
      return listResources(root, rest);
    case "show":
      return showResource(root, rest);
    case "find":
      return findResources(root, rest);
    case "schema":
      return schemaResource(root, rest);
    case "index":
      return indexResources(root, rest);
    case "link":
      return linkResource(root, rest);
    case "rm":
      return removeResource(root, rest);
    case "doctor":
      if (rest.length !== 0) throw new Error(usage());
      return renderResourceDoctor(root);
    case "capture":
      return runCapture(root, rest, deps);
    default:
      throw new Error(usage());
  }
}

export function isResourcesMutation(args: string[]): boolean {
  const [verb, ...rest] = args;
  if (verb === "add" || verb === "link" || verb === "rm" || verb === "index") return true;
  if (verb === "enrich") {
    try {
      return !parseEnrichArgs(rest).dryRun;
    } catch {
      return false;
    }
  }
  if (verb === "capture") {
    if (rest.includes("--auto")) return false;
    const subcommand = rest.find((arg) => !arg.startsWith("--"));
    if (subcommand === "list" || subcommand === "install-hook") return false;
    return true;
  }
  if (verb !== "organise") return false;
  try {
    return !parseOrganiseArgs(rest).dryRun;
  } catch {
    return false;
  }
}
