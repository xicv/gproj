import { appendNdjson, readState, writeState } from "../format/store.js";

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
  appendNdjson(root, "decisions.ndjson", { ts: new Date().toISOString(), title: `phase ${state.currentPhase} decision: ${decision}`, why: `human gate: ${decision}` });
  if (decision === "accept") {
    writeState(root, { ...state, currentPhase: state.currentPhase + 1, status: "planning" });
  } else {
    // adjust and reject both loop back to planning on the same phase
    writeState(root, { ...state, status: "planning" });
  }
}
