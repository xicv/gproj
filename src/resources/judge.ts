import { z } from "zod";
import { PlannerUnavailableError, type PlannerBackend } from "../backends/planner.js";
import type { ResourceCard, ResourceLink } from "../format/schema.js";
import { sanitize } from "../redact/sanitize.js";
import { extractJson } from "./enrich.js";
import { getAll } from "./manifest.js";

const JudgeVerdictSchema = z.object({
  verdict: z.enum(["correct", "weak", "incorrect"]),
  reason: z.string(),
}).strict();

export interface JudgedLink {
  fromId: string;
  rel: ResourceLink["rel"];
  toId: string;
  verdict: "correct" | "weak" | "incorrect" | "unjudged";
  reason: string;
}

export interface JudgeReport {
  totalLinks: number;
  sampled: number;
  judged: number;
  counts: {
    correct: number;
    weak: number;
    incorrect: number;
    unjudged: number;
  };
  linkPrecision: number;
  halted: boolean;
  haltReason?: string;
  verdicts: JudgedLink[];
}

export interface JudgeOptions {
  planner: PlannerBackend;
  sample?: number;
}

interface LinkCandidate {
  from: ResourceCard;
  to?: ResourceCard;
  toId: string;
  rel: ResourceLink["rel"];
}

function assertSample(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new Error("sample must be a nonnegative integer");
  return value;
}

function excerpt(card: ResourceCard): string {
  return (card.excerpt ?? card.body ?? card.description ?? "").trim().slice(0, 1200);
}

function collectLinks(cards: ResourceCard[]): LinkCandidate[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const links: LinkCandidate[] = [];
  for (const from of cards) {
    for (const link of from.links ?? []) {
      const to = byId.get(link.toId);
      links.push({ from, to, toId: link.toId, rel: link.rel });
    }
  }
  return links.sort((a, b) => a.from.id.localeCompare(b.from.id) || a.toId.localeCompare(b.toId) || a.rel.localeCompare(b.rel));
}

function plannerPack(link: LinkCandidate): string {
  if (!link.to) throw new Error(`cannot judge dangling link to missing card: ${link.toId}`);
  return JSON.stringify({
    from: {
      id: link.from.id,
      title: link.from.title,
      excerpt: excerpt(link.from),
    },
    relation: link.rel,
    to: {
      id: link.to.id,
      title: link.to.title,
      excerpt: excerpt(link.to),
    },
  }, null, 2);
}

function plannerInstruction(): string {
  return [
    "Judge whether the resource relationship is correct and meaningful.",
    "Use the from card title/excerpt, relation, and to card title/excerpt only.",
    "Return strict JSON only: {\"verdict\":\"correct\"|\"weak\"|\"incorrect\",\"reason\":\"short reason\"}.",
    "correct means the relationship is specific and useful. weak means plausible but generic or low value. incorrect means unsupported or wrong.",
  ].join("\n");
}

function emptyReport(totalLinks: number, sampled: number): JudgeReport {
  return {
    totalLinks,
    sampled,
    judged: 0,
    counts: { correct: 0, weak: 0, incorrect: 0, unjudged: 0 },
    linkPrecision: 0,
    halted: false,
    verdicts: [],
  };
}

function updatePrecision(report: JudgeReport): void {
  report.judged = report.counts.correct + report.counts.weak + report.counts.incorrect;
  report.linkPrecision = report.judged === 0 ? 0 : report.counts.correct / report.judged;
}

export async function judgeLinks(root: string, options: JudgeOptions): Promise<JudgeReport> {
  const sample = assertSample(options.sample ?? 20);
  const links = collectLinks(getAll(root));
  const sampled = links.slice(0, sample);
  const report = emptyReport(links.length, sampled.length);

  for (const [index, link] of sampled.entries()) {
    const base = { fromId: link.from.id, rel: link.rel, toId: link.toId };
    if (!link.to) {
      report.counts.incorrect += 1;
      report.verdicts.push({ ...base, verdict: "incorrect", reason: "target card missing" });
      continue;
    }
    try {
      const raw = await options.planner.ask({
        mode: "resources-judge",
        phaseKey: `resources-judge:${index + 1}`,
        pack: plannerPack(link),
        instruction: plannerInstruction(),
      });
      const parsed = JudgeVerdictSchema.safeParse(extractJson(raw));
      if (!parsed.success) {
        report.counts.unjudged += 1;
        report.verdicts.push({ ...base, verdict: "unjudged", reason: "planner output did not match judge schema" });
        continue;
      }
      report.counts[parsed.data.verdict] += 1;
      report.verdicts.push({ ...base, verdict: parsed.data.verdict, reason: sanitize(parsed.data.reason).trim() });
    } catch (error) {
      if (error instanceof PlannerUnavailableError) {
        report.halted = true;
        report.haltReason = error.message;
        break;
      }
      report.counts.unjudged += 1;
      const reason = error instanceof Error ? error.message : String(error);
      report.verdicts.push({ ...base, verdict: "unjudged", reason: sanitize(reason).trim() });
    }
  }

  updatePrecision(report);
  return report;
}

export function renderJudgeReport(report: JudgeReport): string {
  const percent = Math.round(report.linkPrecision * 10000) / 100;
  const lines = [
    `link precision (judged ${report.judged}): ${percent}% correct, ${report.counts.weak} weak, ${report.counts.incorrect} incorrect`,
  ];
  if (report.counts.unjudged > 0) lines.push(`unjudged: ${report.counts.unjudged}`);
  const incorrect = report.verdicts.filter((item) => item.verdict === "incorrect").slice(0, 5);
  if (incorrect.length > 0) {
    lines.push("incorrect links:");
    for (const item of incorrect) lines.push(`  ${item.fromId} ${item.rel} ${item.toId}: ${item.reason}`);
  }
  if (report.halted) {
    lines.push(`Planner unavailable. Kept ${report.verdicts.length} partial verdicts; re-run \`gproj resources audit --judge --sample ${report.sampled}\` later to resume.`);
  }
  return lines.join("\n");
}
