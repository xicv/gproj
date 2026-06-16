import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getExecutorTarget } from "../backends/executor.js";
import { loadConfig } from "../config/projectConfig.js";
import { appendJournal } from "../format/journal.js";
import { readState, writeState, readMarkdown } from "../format/store.js";
import { filePath } from "../format/paths.js";
import { createWorktree } from "../sandbox/worktree.js";
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
  const cfg = loadConfig(root);
  let executorCwd = root;
  let activeWorktree: string | null = null;
  let detail: string | undefined;
  if (cfg.sandbox.mode === "worktree") {
    const nodeModulesMissing = !existsSync(join(root, "node_modules"));
    const worktree = createWorktree(root);
    executorCwd = worktree.path;
    activeWorktree = worktree.path;
    detail = nodeModulesMissing
      ? `worktree: ${worktree.path}; node_modules missing, symlink skipped`
      : `worktree: ${worktree.path}`;
    writeState(root, { ...state, activeWorktree });
  } else {
    writeState(root, { ...state, activeWorktree: null });
  }
  appendJournal(root, { phase, event: "exec_start", status: state.status, detail });
  const phaseNN = String(phase).padStart(2, "0");
  const execPrompt = readMarkdown(root, `packages/${phaseNN}-exec-prompt.md`);
  if (!execPrompt) throw new Error(`no exec prompt for phase ${phase}; run \`gproj package\` first`);
  // The executor runs in a sandbox worktree that does NOT contain .gproj/, so it
  // cannot read the phase plan the exec-prompt may reference. Embed the plan as
  // authoritative context so the executor instruction is self-contained.
  const plan = readMarkdown(root, `phases/${phaseNN}.md`);
  const prompt = plan
    ? `# Phase ${phase} plan (authoritative — implement exactly this scope)\n\n${plan}\n\n---\n\n# Executor instruction\n\n${execPrompt}`
    : execPrompt;
  const target = getExecutorTarget(opts.executorName);
  const baseHead = captureHead(executorCwd);
  const result = await target.run({ root: executorCwd, phase, prompt });
  const git = gitEvidence(executorCwd, baseHead);
  const verifier = runChecks(executorCwd, { testCommand: cfg.testCommand, typecheckCommand: cfg.typecheckCommand });
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
    packageId: state.packageId,
    executorClaims: {
      changedFiles: result.changedFiles,
      testsPassed: result.testsPassed,
      diffStat: result.diffStat,
      failures: result.failures,
    },
  });
  writeState(root, { ...state, status: "reviewing", activeWorktree });
  appendJournal(root, { phase, event: "exec_done", status: "reviewing", runId: id, detail });
  return id;
}
