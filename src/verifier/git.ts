import { spawnSync } from "node:child_process";

export type RunFn = (command: string[], cwd: string) => { stdout: string; stderr: string; code: number | null };

const defaultRun: RunFn = (command, cwd) => {
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || result.status === null) {
    return {
      stdout: "",
      stderr: String(result.error ?? "killed"),
      code: result.status ?? null,
    };
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status,
  };
};

export interface GitEvidence {
  baseHead: string | null;
  postHead: string | null;
  isRepo: boolean;
  dirtyAfter: boolean;
  changedFiles: { path: string; status: string }[];
  diffStat: string;
}

export function captureHead(root: string, run: RunFn = defaultRun): string | null {
  const result = run(["git", "rev-parse", "HEAD"], root);
  if (result.code !== 0) return null;
  return result.stdout.trim();
}

export function gitEvidence(root: string, baseHead: string | null, run: RunFn = defaultRun): GitEvidence {
  const postHead = captureHead(root, run);
  if (postHead === null) {
    return { baseHead, postHead: null, isRepo: false, dirtyAfter: false, changedFiles: [], diffStat: "" };
  }

  const status = run(["git", "status", "--porcelain=v1"], root).stdout.trimEnd();
  const changedFiles = parsePorcelain(status);

  return {
    baseHead,
    postHead,
    isRepo: true,
    dirtyAfter: changedFiles.length > 0,
    changedFiles,
    diffStat: run(["git", "diff", "--stat"], root).stdout.trim(),
  };
}

// Pathspec shared with applyWorktree: everything under the worktree except a
// (possibly symlinked) node_modules tree.
const DIFF_PATHSPEC = [".", ":(exclude)node_modules", ":(exclude)node_modules/**"];
const MAX_DIFF_CHARS = 8000;

export function stageForEvidence(
  root: string,
  run: RunFn = defaultRun,
): { staged: true } | { staged: false; detail: string } {
  // No pathspec: node_modules is gitignored, and sandbox worktrees symlink it.
  const add = run(["git", "add", "-A"], root);
  if (add.code !== 0) return { staged: false, detail: add.stderr || add.stdout || "git add -A failed" };
  return { staged: true };
}

// Capture diffStat + a bounded full diff the way applyWorktree actually applies
// changes: `git add -A` then `git diff --cached HEAD`. Plain `git diff --stat`
// (used by gitEvidence) omits UNTRACKED new files, so a feature that adds files
// is under-reported in the evidence. Staging the index makes new files visible.
//
// SAFE ONLY in a disposable sandbox worktree — it mutates the index. Never call
// it on a real repo: exec.ts gates this to sandbox.mode === "worktree", and
// applyWorktree re-runs `git add -A` at decide time so the staging is harmless.
export function captureStagedEvidence(
  root: string,
  run: RunFn = defaultRun,
  opts: { alreadyStaged?: boolean; raw?: boolean } = {},
): { diffStat: string; diff: string } | null {
  if (!opts.alreadyStaged && !opts.raw) {
    const staged = stageForEvidence(root, run);
    if (!staged.staged) return null;
  }
  const diffStat = run(["git", "diff", "--cached", "--stat", "HEAD", "--", ...DIFF_PATHSPEC], root).stdout.trim();
  const full = run(["git", "diff", "--cached", "HEAD", "--", ...DIFF_PATHSPEC], root).stdout;
  const diff = full.length > MAX_DIFF_CHARS
    ? `${full.slice(0, MAX_DIFF_CHARS)}\n… [diff truncated at ${MAX_DIFF_CHARS} chars]`
    : full;
  return { diffStat, diff };
}

function parsePorcelain(output: string): { path: string; status: string }[] {
  if (output.length === 0) return [];
  return output.split("\n").filter(Boolean).map((line) => {
    const status = line.slice(0, 2).trim() || line.slice(0, 2);
    const path = line.slice(3);
    return { status, path };
  });
}
