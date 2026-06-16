import { buildContextPack } from "../assembler/pack.js";
import { getPlannerBackend } from "../backends/planner.js";
import { loadConfig } from "../config/projectConfig.js";
import { appendJournal } from "../format/journal.js";
import { readState, writeState, writeMarkdown } from "../format/store.js";

export interface PackageOpts { plannerName: string; maxTokens: number; }

export async function runPackage(root: string, opts: PackageOpts): Promise<void> {
  const state = readState(root);
  if (!state) throw new Error("gproj not initialized");
  if (state.status !== "init" && state.status !== "planning" && state.status !== "packaged") {
    throw new Error(`cannot package from status ${state.status}`);
  }
  const phase = state.currentPhase;
  const packageId = (state.packageId ?? 0) + 1;
  appendJournal(root, { phase, event: "package_start", status: state.status });
  const result = buildContextPack(root, phase, opts.maxTokens, loadConfig(root).redactions);
  if (result.mandatoryOverflow) {
    throw new Error(`PACK_TOO_LARGE: mandatory context (goal/phase/run evidence) exceeds maxPackTokens=${opts.maxTokens}; raise maxPackTokens or compact decisions/known-issues`);
  }
  const pack = result.text;
  const phaseKey = `p${phase}`;
  const phaseNN = String(phase).padStart(2, "0");
  const planner = getPlannerBackend(opts.plannerName, root);
  const plan = await planner.ask({ pack, instruction: `Produce a phase ${phase} plan: goal, in-scope, out-of-scope, acceptance, tests, risk.`, mode: "plan", phaseKey });
  writeMarkdown(root, `phases/p${phase}-pkg${packageId}.md`, plan);
  writeMarkdown(root, `phases/${phaseNN}.md`, plan);
  const execPrompt = await planner.ask({ pack, instruction: `Produce a single master exec prompt for an executor to implement phase ${phase}. Reference the phase plan; do not expand scope.`, mode: "plan", phaseKey });
  writeMarkdown(root, `packages/p${phase}-pkg${packageId}-exec-prompt.md`, execPrompt);
  writeMarkdown(root, `packages/${phaseNN}-exec-prompt.md`, execPrompt);
  const phases = state.phases.some((p) => p.id === phase)
    ? state.phases
    : [...state.phases, { id: phase, title: `phase ${phase}`, status: "planned" as const }];
  writeState(root, { ...state, packageId, phases, status: "packaged" });
  appendJournal(root, { phase, event: "package_done", status: "packaged" });
}
