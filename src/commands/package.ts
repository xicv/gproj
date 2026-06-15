import { buildContextPack } from "../assembler/pack.js";
import { getPlannerBackend } from "../backends/planner.js";
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
  appendJournal(root, { phase, event: "package_start", status: state.status });
  const pack = buildContextPack(root, phase, opts.maxTokens);
  const planner = getPlannerBackend(opts.plannerName);
  const plan = await planner.ask({ pack, instruction: `Produce a phase ${phase} plan: goal, in-scope, out-of-scope, acceptance, tests, risk.`, mode: "plan" });
  writeMarkdown(root, `phases/${String(phase).padStart(2, "0")}.md`, plan);
  const execPrompt = await planner.ask({ pack, instruction: `Produce a single master exec prompt for an executor to implement phase ${phase}. Reference the phase plan; do not expand scope.`, mode: "plan" });
  writeMarkdown(root, `packages/${String(phase).padStart(2, "0")}-exec-prompt.md`, execPrompt);
  const phases = state.phases.some((p) => p.id === phase)
    ? state.phases
    : [...state.phases, { id: phase, title: `phase ${phase}`, status: "planned" as const }];
  writeState(root, { ...state, phases, status: "packaged" });
  appendJournal(root, { phase, event: "package_done", status: "packaged" });
}
