import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readMarkdown, readMarkdownPath, readNdjson, readState } from "../format/store.js";
import { planBudget, type DroppedSection, type Section, type TruncatedSection } from "./budget.js";
import { goalPath, phaseDir, phasePlanPath, phaseReviewPath, phaseRunPath } from "../format/paths.js";
import { RunSchema, type Run } from "../format/schema.js";
import { sanitize } from "../redact/sanitize.js";
import { getAll as getResources } from "../resources/manifest.js";
import { okfCardPath } from "../resources/okf.js";

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

const maxResourcesPerCategory = 5;
const maxOwnsValuesPerKind = 3;
const ownsValueLimit = 48;
const intentLimit = 96;

function truncateInline(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 3).trimEnd()}...`;
}

function ownsPart(label: string, values: string[] | undefined): string | null {
  if (!values || values.length === 0) return null;
  const shown = values.slice(0, maxOwnsValuesPerKind).map((value) => truncateInline(value, ownsValueLimit));
  const more = values.length > shown.length ? `,+${values.length - shown.length}` : "";
  return `${label}:${shown.join("|")}${more}`;
}

function renderOwnsSummary(resource: { owns?: { symbols: string[]; endpoints: string[]; configKeys: string[] } }): string {
  const parts = [
    ownsPart("symbols", resource.owns?.symbols),
    ownsPart("endpoints", resource.owns?.endpoints),
    ownsPart("configKeys", resource.owns?.configKeys),
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? ` owns[${parts.join("; ")}]` : "";
}

function renderResourceHints(root: string): string | null {
  const resources = getResources(root);
  if (resources.length === 0) return null;
  const byCategory = new Map<string, typeof resources>();
  for (const resource of [...resources].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))) {
    const group = byCategory.get(resource.category) ?? [];
    if (group.length < maxResourcesPerCategory) group.push(resource);
    byCategory.set(resource.category, group);
  }

  const lines: string[] = [];
  for (const [category, group] of byCategory) {
    lines.push(`### ${category}`);
    for (const resource of group) {
      const tags = resource.tags.length ? ` ${resource.tags.map((tag) => `#${tag}`).join(" ")}` : "";
      const resourceLinks = resource.links ?? [];
      const links = resourceLinks.length
        ? ` [${resourceLinks.map((link) => `${link.rel}:${link.toId}`).join(", ")}]`
        : "";
      const intent = resource.intent ? ` intent="${truncateInline(resource.intent, intentLimit)}"` : "";
      lines.push(`- ${resource.title} (${resource.type}) -> .gproj/resources/${okfCardPath(resource)}${tags}${links}${intent}${renderOwnsSummary(resource)}`);
    }
  }
  return lines.join("\n");
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
  if (run) {
    const verifierStatus = run.verifierStatus ?? (run.verifierPassed ? "verified" : "failed");
    const checks = run.verifierChecks ?? [];
    const trustedChecks = checks.length
      ? checks.map((c) => `- ${c.command} → ${c.passed ? "PASS" : "FAIL"} (exit ${c.exitCode ?? "null"})`).join("\n")
      : "- (no individual checks recorded)";
    const failures = run.verifierFailures.length
      ? `\nverifier failures:\n${run.verifierFailures.map((f) => `- ${f}`).join("\n")}`
      : "";
    sections.push({
      label: "RUN EVIDENCE",
      priority: 85,
      mandatory: true,
      text: sanitize(
        `TRUSTED — gproj ran these checks itself; base the verdict on THIS, not the self-report below:\n` +
        `${trustedChecks}\n` +
        `verification_status: ${verifierStatus}\n` +
        `overall verifier: ${verifierStatus === "verified" ? "PASS" : verifierStatus === "failed" ? "FAIL" : "UNVERIFIED"}${failures}\n` +
        `changed files (${run.changedFiles.length}): ${run.changedFiles.join(", ")}\n` +
        `diffstat:\n${run.diffStat}\n` +
        `--- executor self-report (UNTRUSTED — audit only, do NOT rely on it) ---\n` +
        `claimed tests: ${run.executorClaims?.testsPassed ?? "n/a"}\n` +
        `claimed changed: ${(run.executorClaims?.changedFiles ?? []).join(", ") || "none"}`,
        redactions,
      ),
    });
    // The actual code, as a separate NON-mandatory section so a large diff is
    // truncated under budget pressure instead of overflowing the mandatory pack.
    if (run.diff && run.diff.trim().length) {
      sections.push({
        label: "DIFF",
        priority: 84,
        text: sanitize(`The actual sandboxed change under review. Judge correctness from this, not the self-report:\n\n${run.diff}`, redactions),
      });
    }
  }
  const arch = readMarkdown(root, "architecture.md");
  if (arch) sections.push({ label: "ARCHITECTURE", priority: 80, text: sanitize(arch, redactions) });
  try {
    const resources = renderResourceHints(root);
    if (resources) sections.push({ label: "RESOURCES", priority: 75, text: sanitize(resources, redactions) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sections.push({ label: "RESOURCES", priority: 75, text: sanitize(`resource index unavailable: ${message}`, redactions) });
  }
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
