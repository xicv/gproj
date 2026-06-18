import { appendJournal } from "../format/journal.js";
import { goalPath } from "../format/paths.js";
import { readState, writeMarkdownPath, writeState } from "../format/store.js";

export function goalTemplate(goal: string): string {
  return `# Goal\n\n${goal}\n\n## Constraints\n\n(define)\n\n## Acceptance\n\n(define)\n`;
}

export function runRetarget(root: string, goal: string): void {
  const trimmed = goal.trim();
  if (!trimmed) throw new Error('usage: gproj retarget "<new goal>"');
  const state = readState(root);
  if (!state) throw new Error("gproj not initialized");

  const nextPhase = state.currentPhase + 1;
  writeMarkdownPath(goalPath(root), goalTemplate(trimmed));
  const phases = state.phases.some((phase) => phase.id === nextPhase)
    ? state.phases
    : [...state.phases, { id: nextPhase, title: `phase ${nextPhase}`, status: "pending" as const }];
  writeState(root, { ...state, currentPhase: nextPhase, status: "planning", phases });
  appendJournal(root, { phase: nextPhase, event: "retarget", status: "planning" });
}
