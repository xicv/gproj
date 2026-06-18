import { createHash } from "node:crypto";
import type { ResourceEnvironment } from "../../format/schema.js";
import type { TranscriptEvent, TranscriptSlice } from "./transcript.js";
import { redactText, redactValue } from "./redact.js";

export type CaptureClassification = "debug" | "research" | "feature";

export interface ClassificationScores {
  debug: number;
  research: number;
  feature: number;
}

export interface CaptureDigest {
  steps: string[];
  toolSequence: string[];
  fingerprint: string;
  environment: ResourceEnvironment;
  userPrompts: string[];
  facts: string[];
}

export interface DigestResult {
  substantive: boolean;
  skipReason?: string;
  classification: CaptureClassification;
  classificationScores: ClassificationScores;
  digest: CaptureDigest;
}

const maxFieldLength = 500;

function truncate(value: string, max = maxFieldLength): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 3)}...`;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function textForClassification(event: TranscriptEvent): string {
  const input = event.input === undefined ? "" : JSON.stringify(event.input);
  return [event.text, event.toolName, input].filter(Boolean).join(" ").toLowerCase();
}

function scoreKeywords(text: string, keywords: string[]): number {
  return keywords.reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0);
}

function classificationScores(events: TranscriptEvent[]): ClassificationScores {
  const scores: ClassificationScores = { debug: 0, research: 0, feature: 0 };
  for (const event of events) {
    const text = textForClassification(event);
    const tool = (event.toolName ?? "").toLowerCase();
    if (event.kind === "tool_result" && event.ok === false) scores.debug += 3;
    if (/(db|sql|sqlite|postgres|mysql|redis|log|browser|playwright|sentry)/.test(tool) || /(database|sql|sqlite|postgres|mysql|redis|log|trace|browser)/.test(text)) {
      scores.debug += 1;
    }
    if (event.kind === "tool_use" && /(edit|write|apply_patch|multiedit|create|update)/.test(tool)) scores.feature += 2;
    if (event.kind === "tool_use" && /(read|grep|rg|find|search|web|open|cat|sed)/.test(tool)) scores.research += 1;
    scores.debug += scoreKeywords(text, ["fix", "broken", "error", "failing", "failed", "bug", "regression"]);
    scores.feature += scoreKeywords(text, ["add", "implement", "build", "create", "wire", "ship"]);
    scores.research += scoreKeywords(text, ["how", "compare", "understand", "research", "investigate", "inspect"]);
  }
  return scores;
}

function classify(scores: ClassificationScores): CaptureClassification {
  if (scores.debug >= scores.feature && scores.debug >= scores.research && scores.debug > 0) return "debug";
  if (scores.feature >= scores.research && scores.feature > 0) return "feature";
  return "research";
}

function hasClassificationSignal(scores: ClassificationScores): boolean {
  return scores.debug > 0 || scores.feature > 0 || scores.research > 0;
}

function redactedEventText(event: TranscriptEvent): string {
  if (event.kind === "tool_use") return JSON.stringify(redactValue(event.input ?? {}));
  return redactText(event.text ?? "").text;
}

function appendSignal(map: Map<keyof ResourceEnvironment, Set<string>>, key: keyof ResourceEnvironment, value: string): void {
  const current = map.get(key) ?? new Set<string>();
  current.add(value);
  map.set(key, current);
}

function inferEnvironment(events: TranscriptEvent[]): ResourceEnvironment {
  const signals = new Map<keyof ResourceEnvironment, Set<string>>();
  for (const event of events) {
    const text = redactedEventText(event);
    const lower = `${event.toolName ?? ""} ${text}`.toLowerCase();
    if (/(sqlite|postgres|postgresql|mysql|mariadb|redis|database|sql\b)/.test(lower)) appendSignal(signals, "db", "database");
    if (/(docker|redis|mailpit|sentry|github|gmail|browser|playwright|oracle|openai|claude)/.test(lower)) {
      for (const match of lower.matchAll(/\b(docker|redis|mailpit|sentry|github|gmail|browser|playwright|oracle|openai|claude)\b/g)) {
        appendSignal(signals, "services", match[1]);
      }
    }
    if (/\bmcp\b/.test(lower)) appendSignal(signals, "mcp", "mcp");
    for (const match of text.matchAll(/\b(?:src|tests|docs|\.gproj|\/tmp|~\/|[A-Za-z0-9_.-]+\/)[A-Za-z0-9_./-]+\b/g)) {
      appendSignal(signals, "files", truncate(match[0], 160));
    }
    for (const match of text.matchAll(/\bhttps?:\/\/[^\s"'<>]+/g)) {
      appendSignal(signals, "urls", truncate(redactText(match[0]).text, 200));
    }
  }

  const environment: ResourceEnvironment = {};
  for (const [key, values] of signals) {
    const sorted = uniqueSorted([...values]).slice(0, 20);
    if (sorted.length > 0) environment[key] = sorted;
  }
  return environment;
}

function buildSteps(events: TranscriptEvent[]): string[] {
  return events.slice(0, 80).map((event) => {
    if (event.kind === "user_prompt") return `prompt: ${truncate(redactText(event.text ?? "").text)}`;
    if (event.kind === "tool_use") return `tool_use: ${event.toolName ?? "unknown"}`;
    return `tool_result: ${event.toolName ?? "unknown"} ${event.ok === false ? "error" : "ok"}`;
  });
}

function buildFacts(events: TranscriptEvent[]): string[] {
  const facts: string[] = [];
  for (const event of events) {
    if (event.kind === "user_prompt" && event.text) facts.push(`User asked: ${truncate(redactText(event.text).text, 220)}`);
    if (event.kind === "tool_result" && event.ok === false) facts.push(`Tool ${event.toolName ?? "unknown"} returned an error.`);
    if (facts.length >= 12) break;
  }
  return uniqueSorted(facts);
}

export function buildDigest(slice: TranscriptSlice): DigestResult {
  const toolSequence = slice.events
    .filter((event) => event.kind === "tool_use")
    .map((event) => event.toolName ?? "unknown");
  const userPrompts = slice.events
    .filter((event) => event.kind === "user_prompt")
    .map((event) => truncate(redactText(event.text ?? "").text))
    .filter(Boolean)
    .slice(0, 20);
  const scores = classificationScores(slice.events);
  const classification = classify(scores);
  const environment = inferEnvironment(slice.events);
  const facts = buildFacts(slice.events);
  const steps = buildSteps(slice.events);
  const fingerprint = hashJson({
    classification,
    toolSequence,
    userPrompts,
    environment,
    facts,
  });
  const digest: CaptureDigest = {
    steps,
    toolSequence,
    fingerprint,
    environment,
    userPrompts,
    facts,
  };

  if (toolSequence.length < 3) {
    return {
      substantive: false,
      skipReason: "substantive gate: fewer than 3 tool calls",
      classification,
      classificationScores: scores,
      digest,
    };
  }
  if (!hasClassificationSignal(scores)) {
    return {
      substantive: false,
      skipReason: "substantive gate: no classification signal",
      classification,
      classificationScores: scores,
      digest,
    };
  }
  return { substantive: true, classification, classificationScores: scores, digest };
}
