import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { getExecutorTarget } from "../backends/executor.js";
import { loadConfig } from "../config/projectConfig.js";
import { appendJournal } from "../format/journal.js";
import { readState, writeState, readMarkdown } from "../format/store.js";
import { filePath } from "../format/paths.js";
import { captureHead, gitEvidence } from "../verifier/git.js";
import { runChecks } from "../verifier/tests.js";
import { ingestRun } from "./ingestRun.js";

export interface ExecOpts { executorName: string; }

function nextRunIndex(root: string, phase: number): number {
  const dir = filePath(root, "runs");
  if (!existsSync(dir)) return 1;
  const idxs = readdirSync(dir)
    .map((f) => f.match(new RegExp(`^p${phase}-r(\\d+)\\.json$`)))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => Number(m[1]));
  return (idxs.length ? Math.max(...idxs) : 0) + 1;
}

export async function runExec(root: string, opts: ExecOpts): Promise<string> {
  const state = readState(root);
  if (!state) throw new Error("gproj not initialized");
  if (state.status !== "packaged") {
    throw new Error(`no packaged phase to execute; run \`gproj package\` first (status: ${state.status})`);
  }
  const phase = state.currentPhase;
  appendJournal(root, { phase, event: "exec_start", status: state.status });
  const prompt = readMarkdown(root, `packages/${String(phase).padStart(2, "0")}-exec-prompt.md`);
  if (!prompt) throw new Error(`no exec prompt for phase ${phase}; run \`gproj package\` first`);
  const target = getExecutorTarget(opts.executorName);
  const baseHead = captureHead(root);
  const result = await target.run({ root, phase, prompt });
  const cfg = loadConfig(root);
  const git = gitEvidence(root, baseHead);
  const verifier = runChecks(root, { testCommand: cfg.testCommand, typecheckCommand: cfg.typecheckCommand });
  const id = `p${phase}-r${nextRunIndex(root, phase)}`;
  ingestRun(root, {
    id,
    phase,
    promptHash: createHash("sha1").update(prompt).digest("hex").slice(0, 12),
    baseHead,
    postHead: git.postHead,
    changedFiles: git.changedFiles.map((c) => c.path),
    diffStat: git.diffStat,
    testsPassed: verifier.verifierPassed,
    failures: verifier.verifierFailures,
    verifierPassed: verifier.verifierPassed,
    verifierFailures: verifier.verifierFailures,
    executorClaims: {
      changedFiles: result.changedFiles,
      testsPassed: result.testsPassed,
      diffStat: result.diffStat,
      failures: result.failures,
    },
  });
  writeState(root, { ...state, status: "reviewing" });
  appendJournal(root, { phase, event: "exec_done", status: "reviewing", runId: id });
  return id;
}
