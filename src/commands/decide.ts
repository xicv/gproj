import { appendJournal } from "../format/journal.js";
import { appendNdjson, readState, writeState } from "../format/store.js";
import { applyWorktree, removeWorktree } from "../sandbox/worktree.js";
import { captureHead } from "../verifier/git.js";
import { latestRunForPhase } from "../assembler/pack.js";

export type Decision = "accept" | "adjust" | "reject";

export function runDecide(root: string, decision: Decision): void {
  if (decision !== "accept" && decision !== "adjust" && decision !== "reject") {
    throw new Error("decision must be one of accept|adjust|reject");
  }
  const state = readState(root);
  if (!state) throw new Error("gproj not initialized");
  if (state.status !== "deciding") {
    throw new Error(`nothing to decide; run \`gproj review\` first (status: ${state.status})`);
  }
  // TOCTOU guard: the sandbox worktree was created from root's HEAD at exec
  // time (recorded as run.baseHead). Applying its patch onto a root whose
  // HEAD has since moved risks a corrupt/wrong apply. Refuse and tell the
  // user to rebuild. Only checks when we have both hashes and a worktree to
  // apply; null hashes (non-repo) fall through unchanged.
  if (decision === "accept" && state.activeWorktree) {
    const run = latestRunForPhase(root, state.currentPhase);
    const currentHead = captureHead(root);
    if (run?.baseHead && currentHead && run.baseHead !== currentHead) {
      throw new Error(
        `root HEAD moved since exec (recorded ${run.baseHead.slice(0, 12)}, now ${currentHead.slice(0, 12)}); ` +
        `refusing to apply stale sandbox changes. Re-run \`gproj exec\` to rebuild against the current root, then review and decide again.`,
      );
    }
  }
  appendNdjson(root, "decisions.ndjson", { ts: new Date().toISOString(), title: `phase ${state.currentPhase} decision: ${decision}`, why: `human gate: ${decision}` });
  appendJournal(root, { phase: state.currentPhase, event: "decide", status: state.status, detail: decision });
  const nextState = decision === "accept"
    ? { ...state, currentPhase: state.currentPhase + 1, status: "planning" as const }
    : { ...state, status: "planning" as const };
  if (state.activeWorktree) {
    if (decision === "accept") {
      const applied = applyWorktree(root, state.activeWorktree);
      appendJournal(root, {
        phase: state.currentPhase,
        event: "sandbox_apply",
        status: state.status,
        detail: applied.detail,
      });
      if (applied.conflict) {
        throw new Error(`sandbox changes conflict on apply; resolve manually in ${state.activeWorktree}`);
      }
      removeWorktree(root, state.activeWorktree);
    } else {
      removeWorktree(root, state.activeWorktree);
      appendJournal(root, {
        phase: state.currentPhase,
        event: "sandbox_discard",
        status: state.status,
        detail: state.activeWorktree,
      });
    }
    writeState(root, { ...nextState, activeWorktree: null });
    return;
  }
  if (decision === "accept") {
    writeState(root, nextState);
  } else {
    // adjust and reject both loop back to planning on the same phase
    writeState(root, nextState);
  }
}
