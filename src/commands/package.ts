import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { buildContextPack } from "../assembler/pack.js";
import { getPlannerBackend } from "../backends/planner.js";
import { loadConfig } from "../config/projectConfig.js";
import { appendJournal } from "../format/journal.js";
import { goalPath, phaseDir, phaseExecPromptPath, phasePlanPath } from "../format/paths.js";
import { readState, writeState, writeMarkdownPath } from "../format/store.js";

export interface PackageOpts { plannerName: string; maxTokens: number; }

export function currentGoalHash(root: string): string {
  return createHash("sha256").update(readFileSync(goalPath(root), "utf8")).digest("hex").slice(0, 12);
}

function clearPhaseArtifacts(root: string, phase: number): void {
  const dir = phaseDir(root, phase);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (
      name === "plan.md" ||
      name === "exec-prompt.md" ||
      name === "decision.md" ||
      /^run-\d+\.json$/.test(name) ||
      /^review-\d+\.md$/.test(name)
    ) {
      rmSync(`${dir}/${name}`, { force: true });
    }
  }
}

export async function runPackage(root: string, opts: PackageOpts): Promise<void> {
  const state = readState(root);
  if (!state) throw new Error("gproj not initialized");
  if (state.status !== "init" && state.status !== "planning" && state.status !== "packaged") {
    throw new Error(`cannot package from status ${state.status}`);
  }
  const phase = state.currentPhase;
  const packageId = (state.packageId ?? 0) + 1;
  const goalHash = currentGoalHash(root);
  appendJournal(root, { phase, event: "package_start", status: state.status });
  clearPhaseArtifacts(root, phase);
  const result = buildContextPack(root, phase, opts.maxTokens, loadConfig(root).redactions);
  if (result.mandatoryOverflow) {
    throw new Error(`PACK_TOO_LARGE: mandatory context (goal/phase/run evidence) exceeds maxPackTokens=${opts.maxTokens}; raise maxPackTokens or compact decisions/known-issues`);
  }
  const pack = result.text;
  const phaseKey = `p${phase}`;
  const planner = getPlannerBackend(opts.plannerName, root);
  const plan = await planner.ask({ pack, instruction: `Produce a phase ${phase} plan: goal, in-scope, out-of-scope, acceptance, tests, risk.`, mode: "plan", phaseKey });
  writeMarkdownPath(phasePlanPath(root, phase), plan);
  const execPrompt = await planner.ask({ pack, instruction: `Produce a single master exec prompt for an executor to implement phase ${phase}. Reference the phase plan; do not expand scope.`, mode: "plan", phaseKey });
  writeMarkdownPath(phaseExecPromptPath(root, phase), execPrompt);
  const phases = state.phases.some((p) => p.id === phase)
    ? state.phases.map((item) => item.id === phase ? { ...item, status: "planned" as const, goalHash } : item)
    : [...state.phases, { id: phase, title: `phase ${phase}`, status: "planned" as const, goalHash }];
  writeState(root, { ...state, packageId, phases, status: "packaged" });
  appendJournal(root, { phase, event: "package_done", status: "packaged" });
}
