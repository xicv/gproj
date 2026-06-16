import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readMarkdown, readMarkdownPath, readNdjson, readState } from "../format/store.js";
import { planBudget, type DroppedSection, type Section, type TruncatedSection } from "./budget.js";
import { goalPath, phaseDir, phasePlanPath, phaseReviewPath, phaseRunPath } from "../format/paths.js";
import { RunSchema, type Run } from "../format/schema.js";
import { sanitize } from "../redact/sanitize.js";

export function latestRunForPhase(root: string, phase: number): Run | null {
  const dir = phaseDir(root, phase);
  if (!existsSync(dir)) return null;
  const runs = readdirSync(dir)
    .map((f) => {
      const match = f.match(/^run-(\d+)\.json$/);
      return match ? { index: Number(match[1]), name: f } : null;
    })
    .filter((f): f is { index: number; name: string } => f !== null)
    .sort((a, b) => b.index - a.index)
    .map((f) => { try { return RunSchema.parse(JSON.parse(readFileSync(phaseRunPath(root, phase, f.index), "utf8"))); } catch { return null; } })
    .filter((r): r is Run => r !== null && r.phase === phase);
  return runs.length ? runs[0] : null;
}

function latestReview(root: string, phase: number): string | null {
  const dir = phaseDir(root, phase);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .map((name) => {
      const match = name.match(/^review-(\d+)\.md$/);
      return match ? { index: Number(match[1]), name } : null;
    })
    .filter((review): review is { index: number; name: string } => review !== null)
    .sort((a, b) => a.index - b.index);
  if (!files.length) return null;
  return readFileSync(phaseReviewPath(root, phase, files[files.length - 1].index), "utf8");
}

export interface PackResult {
  text: string;
  estimatedTokens: number;
  dropped: DroppedSection[];
  truncated: TruncatedSection[];
  mandatoryOverflow: boolean;
}

export function buildContextPack(root: string, phaseId: number, maxTokens: number, redactions: string[] = []): PackResult {
  const sections: Section[] = [];
  const goal = readMarkdownPath(goalPath(root));
  if (goal) sections.push({ label: "GOAL", priority: 100, mandatory: true, text: sanitize(goal, redactions) });
  const phase = readMarkdownPath(phasePlanPath(root, phaseId));
  if (phase) sections.push({ label: `PHASE ${phaseId}`, priority: 90, mandatory: true, text: sanitize(phase, redactions) });
  const run = latestRunForPhase(root, phaseId);
  if (run) sections.push({
    label: "RUN EVIDENCE",
    priority: 85,
    mandatory: true,
    text: sanitize(`verified: ${run.verifierPassed ? "PASS" : "FAIL"}\nchanged (git): ${run.changedFiles.join(", ")}\ndiffstat (git): ${run.diffStat}\nverifier failures:\n${run.verifierFailures.map((f) => `- ${f}`).join("\n")}\n--- executor claims (UNTRUSTED, do not rely on) ---\nclaimed tests: ${run.executorClaims?.testsPassed ?? "n/a"}\nclaimed changed: ${(run.executorClaims?.changedFiles ?? []).join(", ")}`, redactions),
  });
  const arch = readMarkdown(root, "architecture.md");
  if (arch) sections.push({ label: "ARCHITECTURE", priority: 80, text: sanitize(arch, redactions) });
  const decisions = readNdjson(root, "decisions.ndjson") as { title: string; why: string }[];
  if (decisions.length) sections.push({ label: "DECISIONS", priority: 70, text: sanitize(decisions.map((d) => `- ${d.title}: ${d.why}`).join("\n"), redactions) });
  const lastReview = latestReview(root, phaseId);
  if (lastReview) sections.push({ label: "LAST REVIEW", priority: 65, text: sanitize(lastReview, redactions) });
  const state = readState(root);
  if (state) sections.push({ label: "STATE", priority: 60, text: sanitize(`phase ${state.currentPhase}, status ${state.status}`, redactions) });
  const issues = readNdjson(root, "known-issues.ndjson") as { issue: string; severity: string }[];
  if (issues.length) sections.push({ label: "KNOWN ISSUES", priority: 40, text: sanitize(issues.map((i) => `- [${i.severity}] ${i.issue}`).join("\n"), redactions) });
  const result = planBudget(sections, maxTokens);
  return {
    text: result.sections.map((s) => `## ${s.label}\n${s.text}`).join("\n\n"),
    estimatedTokens: result.estimatedTokens,
    dropped: result.dropped,
    truncated: result.truncated,
    mandatoryOverflow: result.mandatoryOverflow,
  };
}
