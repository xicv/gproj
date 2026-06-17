import { existsSync, readdirSync, readFileSync } from "node:fs";
import { phaseDir, phaseRunPath } from "../format/paths.js";
import { readJournal } from "../format/journal.js";
import { RunSchema } from "../format/schema.js";
import { readState } from "../format/store.js";
import { inspectLock } from "../lock/inspect.js";
import { detectInterrupted, retryCommandFor } from "./recover.js";
import { NEXT } from "./status.js";

function latestRunVerifier(root: string, phase: number): string {
  const dir = phaseDir(root, phase);
  if (!existsSync(dir)) return "n/a";
  const latest = readdirSync(dir)
    .map((name) => {
      const match = name.match(/^run-(\d+)\.json$/);
      return match ? { name, index: Number(match[1]) } : null;
    })
    .filter((run): run is { name: string; index: number } => run !== null)
    .sort((a, b) => b.index - a.index)[0];
  if (!latest) return "n/a";
  const run = RunSchema.parse(JSON.parse(readFileSync(phaseRunPath(root, phase, latest.index), "utf8")));
  if (run.verifierStatus === "unverified") return "UNVERIFIED";
  if (run.verifierStatus === "verified") return "PASS";
  if (run.verifierStatus === "failed") return "FAIL";
  return run.verifierPassed ? "PASS" : "FAIL";
}

export function renderDoctor(root: string): string {
  const state = readState(root);
  if (!state) return "gproj: not initialized (run `gproj init \"<goal>\"`)";

  const journal = readJournal(root);
  const lastJournal = journal.at(-1);
  const lock = inspectLock(root);
  const interrupted = detectInterrupted(journal);
  const lockLine = lock.exists
    ? `held by pid ${lock.pid ?? "unknown"}${lock.label ? ` (${lock.label})` : ""}${lock.stale ? ", stale" : ""}`
    : "none";
  const recoverLine = interrupted.interrupted ? `yes, run \`${retryCommandFor(interrupted.op)}\` after \`gproj recover\`` : "no";

  return [
    `phase: ${state.currentPhase}`,
    `status: ${state.status}`,
    `next: ${NEXT[state.status] ?? "(unknown)"}`,
    `last journal: ${lastJournal ? `${lastJournal.event} at ${lastJournal.ts}` : "none"}`,
    `lock: ${lockLine}`,
    `verifier: ${latestRunVerifier(root, state.currentPhase)}`,
    `recover recommended: ${recoverLine}`,
  ].join("\n");
}
