import { appendJournal, readJournal } from "../format/journal.js";
import type { JournalEntry, JournalEvent } from "../format/journal.js";
import { readState, writeState } from "../format/store.js";
import { clearRecoverableLock } from "../lock/inspect.js";
import { withLock } from "../lock/lock.js";
import { removeWorktree } from "../sandbox/worktree.js";

export interface RecoverSummary {
  interrupted: boolean;
  actions: string[];
  recommendation: string;
}

export interface InterruptedOperation {
  op: "package" | "exec" | "review";
  phase: number;
}

export type InterruptedDetection =
  | { interrupted: false }
  | { interrupted: true; op: InterruptedOperation["op"]; phase: number };

const startToOp: Partial<Record<JournalEvent, InterruptedOperation["op"]>> = {
  package_start: "package",
  exec_start: "exec",
  review_start: "review",
};

export function detectInterrupted(journal: JournalEntry[]): InterruptedDetection {
  const last = journal.at(-1);
  if (!last) return { interrupted: false };
  const op = startToOp[last.event];
  return op ? { interrupted: true, op, phase: last.phase } : { interrupted: false };
}

export function retryCommandFor(op: InterruptedOperation["op"]): string {
  return `gproj ${op}`;
}

export function recoveryRecommendation(interrupted: InterruptedOperation | null): string {
  if (!interrupted) return "no recovery needed";
  const note = interrupted.op === "exec"
    ? "; working tree may have partial edits (the verifier will capture real state on the next exec)"
    : "";
  return `retry with \`${retryCommandFor(interrupted.op)}\`${note}`;
}

export async function runRecover(root: string): Promise<RecoverSummary> {
  const actions: string[] = [];
  if (clearRecoverableLock(root)) actions.push("cleared stale lock");

  return withLock(root, "recover", () => {
    const state = readState(root);
    if (!state) throw new Error("gproj not initialized");

    const journal = readJournal(root);
    const detected = detectInterrupted(journal);
    const interrupted = detected.interrupted
      ? { op: detected.op, phase: detected.phase }
      : null;
    if (interrupted) {
      appendJournal(root, {
        phase: interrupted.phase,
        event: "abort",
        status: state.status,
        detail: interrupted.op,
      });
      actions.push(`recorded abort for ${interrupted.op}`);
    }

    if (state.activeWorktree && interrupted?.op === "exec") {
      removeWorktree(root, state.activeWorktree);
      writeState(root, { ...state, activeWorktree: null });
      actions.push("removed orphaned sandbox worktree");
    }

    const recommendation = recoveryRecommendation(interrupted);
    appendJournal(root, {
      phase: state.currentPhase,
      event: "recover",
      status: state.status,
      detail: recommendation,
    });

    return {
      interrupted: interrupted !== null,
      actions,
      recommendation,
    };
  });
}
