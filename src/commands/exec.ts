import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getExecutorTarget } from "../backends/executor.js";
import { loadConfig, projectConfigExists } from "../config/projectConfig.js";
import { appendJournal } from "../format/journal.js";
import { readState, writeState, readMarkdownPath } from "../format/store.js";
import { phaseDir, phaseExecPromptPath, phasePlanPath, phaseRunPath } from "../format/paths.js";
import { RunSchema } from "../format/schema.js";
import { createWorktree } from "../sandbox/worktree.js";
import { captureHead, captureStagedEvidence, gitEvidence, stageForEvidence } from "../verifier/git.js";
import { runChecks, UNVERIFIED_RUN_BANNER } from "../verifier/tests.js";
import { ingestRun } from "./ingestRun.js";

export interface ExecOpts { executorName: string; }

function nextRunIndex(root: string, phase: number): number {
  const dir = phaseDir(root, phase);
  if (!existsSync(dir)) return 1;
  const idxs = readdirSync(dir)
    .map((f) => f.match(/^run-(\d+)\.json$/))
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
  const hasConfig = projectConfigExists(root);
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
  const execPrompt = readMarkdownPath(phaseExecPromptPath(root, phase));
  if (!execPrompt) throw new Error(`no exec prompt for phase ${phase}; run \`gproj package\` first`);
  // The executor runs in a sandbox worktree that does NOT contain .gproj/, so it
  // cannot read the phase plan the exec-prompt may reference. Embed the plan as
  // authoritative context so the executor instruction is self-contained.
  const plan = readMarkdownPath(phasePlanPath(root, phase));
  const prompt = plan
    ? `# Phase ${phase} plan (authoritative — implement exactly this scope)\n\n${plan}\n\n---\n\n# Executor instruction\n\n${execPrompt}`
    : execPrompt;
  const target = getExecutorTarget(opts.executorName);
  const baseHead = captureHead(executorCwd);
  const result = await target.run({ root: executorCwd, phase, prompt });
  let stagedForEvidence = false;
  if (baseHead !== null) {
    const staged = stageForEvidence(executorCwd);
    if (!staged.staged) throw new Error(`cannot stage git evidence: ${staged.detail}`);
    stagedForEvidence = true;
  }
  const git = gitEvidence(executorCwd, baseHead);
  // Capture diffStat + a bounded diff after staging so new files are visible in
  // review evidence. Non-git roots remain supported and simply have no diff.
  let diffStat = git.diffStat;
  let diff = "";
  if (stagedForEvidence) {
    const staged = captureStagedEvidence(executorCwd, undefined, { alreadyStaged: true });
    if (staged) {
      diffStat = staged.diffStat;
      diff = staged.diff;
    } else {
      throw new Error("cannot capture staged git evidence after staging completed");
    }
  }
  const verifier = runChecks(executorCwd, {
    testCommand: cfg.testCommand,
    typecheckCommand: cfg.typecheckCommand,
    configExists: hasConfig,
  });
  const id = `p${phase}-r${nextRunIndex(root, phase)}`;
  ingestRun(root, {
    id,
    phase,
    promptHash: createHash("sha1").update(prompt).digest("hex").slice(0, 12),
    baseHead,
    postHead: git.postHead,
    changedFiles: git.changedFiles.map((c) => c.path),
    diffStat,
    diff,
    testsPassed: verifier.verifierPassed,
    failures: verifier.verifierFailures,
    verifierStatus: verifier.verifierStatus,
    verifierPassed: verifier.verifierPassed,
    verifierFailures: verifier.verifierFailures,
    verifierChecks: verifier.checks.map((c) => ({ command: c.command.join(" "), passed: c.passed, exitCode: c.exitCode })),
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

export function renderRunVerificationWarning(root: string, id: string): string | null {
  const match = id.match(/^p(\d+)-r(\d+)$/);
  if (!match) return null;
  const run = RunSchema.parse(JSON.parse(readFileSync(phaseRunPath(root, Number(match[1]), Number(match[2])), "utf8")));
  if (run.verifierStatus !== "unverified") return null;
  const detail = run.verifierFailures.length ? `\nwarning: ${run.verifierFailures.join("; ")}` : "";
  return `${UNVERIFIED_RUN_BANNER}${detail}`;
}
