import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readMarkdown, readNdjson, readState } from "../format/store.js";
import { pruneToBudget, type Section } from "./budget.js";
import { filePath } from "../format/paths.js";
import { RunSchema, type Run } from "../format/schema.js";

function latestRunForPhase(root: string, phase: number): Run | null {
  const dir = filePath(root, "runs");
  if (!existsSync(dir)) return null;
  const runs = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => { try { return RunSchema.parse(JSON.parse(readFileSync(filePath(root, `runs/${f}`), "utf8"))); } catch { return null; } })
    .filter((r): r is Run => r !== null && r.phase === phase);
  return runs.length ? runs[runs.length - 1] : null;
}

function latestReview(root: string, phase: number): string | null {
  const dir = filePath(root, "reviews");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.startsWith(`p${phase}-`) && f.endsWith(".md")).sort();
  if (!files.length) return null;
  return readFileSync(filePath(root, `reviews/${files[files.length - 1]}`), "utf8");
}

export function buildContextPack(root: string, phaseId: number, maxTokens: number): string {
  const sections: Section[] = [];
  const goal = readMarkdown(root, "project.md");
  if (goal) sections.push({ label: "GOAL", priority: 100, mandatory: true, text: goal });
  const phase = readMarkdown(root, `phases/${String(phaseId).padStart(2, "0")}.md`);
  if (phase) sections.push({ label: `PHASE ${phaseId}`, priority: 90, mandatory: true, text: phase });
  const run = latestRunForPhase(root, phaseId);
  if (run) sections.push({ label: "RUN EVIDENCE", priority: 85, mandatory: true, text: `tests: ${run.testsPassed ? "pass" : "fail"}\nchanged: ${run.changedFiles.join(", ")}\ndiffstat: ${run.diffStat}\nfailures:\n${run.failures.map((f) => `- ${f}`).join("\n")}` });
  const arch = readMarkdown(root, "architecture.md");
  if (arch) sections.push({ label: "ARCHITECTURE", priority: 80, text: arch });
  const decisions = readNdjson(root, "decisions.ndjson") as { title: string; why: string }[];
  if (decisions.length) sections.push({ label: "DECISIONS", priority: 70, text: decisions.map((d) => `- ${d.title}: ${d.why}`).join("\n") });
  const lastReview = latestReview(root, phaseId);
  if (lastReview) sections.push({ label: "LAST REVIEW", priority: 65, text: lastReview });
  const state = readState(root);
  if (state) sections.push({ label: "STATE", priority: 60, text: `phase ${state.currentPhase}, status ${state.status}` });
  const issues = readNdjson(root, "known-issues.ndjson") as { issue: string; severity: string }[];
  if (issues.length) sections.push({ label: "KNOWN ISSUES", priority: 40, text: issues.map((i) => `- [${i.severity}] ${i.issue}`).join("\n") });
  const kept = pruneToBudget(sections, maxTokens);
  return kept.sort((a, b) => b.priority - a.priority).map((s) => `## ${s.label}\n${s.text}`).join("\n\n");
}
