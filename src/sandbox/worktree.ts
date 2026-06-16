import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type GitRun = (args: string[], cwd: string) => { stdout: string; stderr: string; code: number | null };

let worktreeCounter = 0;
let patchCounter = 0;

const defaultGitRun: GitRun = (args, cwd) => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
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

export function createWorktree(root: string, gitRun: GitRun = defaultGitRun): { path: string } {
  const repo = gitRun(["rev-parse", "--is-inside-work-tree"], root);
  if (repo.code !== 0 || repo.stdout.trim() !== "true") {
    throw new Error(`cannot create sandbox worktree: ${root} is not a git repository`);
  }

  const path = join(tmpdir(), `gproj-worktree-${process.pid}-${++worktreeCounter}`);
  const added = gitRun(["worktree", "add", "--detach", path, "HEAD"], root);
  if (added.code !== 0) {
    throw new Error(`cannot create sandbox worktree at ${path}: ${added.stderr || added.stdout}`);
  }

  const rootNodeModules = join(root, "node_modules");
  if (existsSync(rootNodeModules)) {
    try {
      symlinkSync(rootNodeModules, join(path, "node_modules"), "dir");
    } catch {
      // Best-effort convenience for verifier commands; sandbox execution still works without it.
    }
  }

  return { path };
}

export function applyWorktree(
  root: string,
  worktreePath: string,
  gitRun: GitRun = defaultGitRun,
): { applied: boolean; conflict: boolean; detail: string } {
  removeNodeModulesSymlink(worktreePath);
  const add = gitRun(["-C", worktreePath, "add", "-A"], root);
  if (add.code !== 0) return { applied: false, conflict: true, detail: add.stderr || add.stdout };

  const diff = gitRun([
    "-C",
    worktreePath,
    "diff",
    "--cached",
    "HEAD",
    "--",
    ".",
    ":(exclude)node_modules",
    ":(exclude)node_modules/**",
  ], root);
  if (diff.code !== 0) return { applied: false, conflict: true, detail: diff.stderr || diff.stdout };
  if (diff.stdout.trim().length === 0) return { applied: false, conflict: false, detail: "no changes" };

  const patchPath = join(tmpdir(), `gproj-worktree-patch-${process.pid}-${++patchCounter}.patch`);
  try {
    writeFileSync(patchPath, diff.stdout);
    const applied = gitRun(["-C", root, "apply", patchPath], root);
    if (applied.code !== 0) return { applied: false, conflict: true, detail: applied.stderr || applied.stdout };
    return { applied: true, conflict: false, detail: "applied" };
  } finally {
    try {
      rmSync(patchPath, { force: true });
    } catch {
      // Best-effort cleanup must not hide apply results.
    }
  }
}

export function removeWorktree(root: string, worktreePath: string, gitRun: GitRun = defaultGitRun): void {
  removeNodeModulesSymlink(worktreePath);
  try {
    gitRun(["worktree", "remove", "--force", worktreePath], root);
  } catch {
    // Ignore cleanup failures; recover can retry or the user can inspect manually.
  }
}

function removeNodeModulesSymlink(worktreePath: string): void {
  try {
    const nodeModules = join(worktreePath, "node_modules");
    if (existsSync(nodeModules) && lstatSync(nodeModules).isSymbolicLink()) unlinkSync(nodeModules);
  } catch {
    // Ignore cleanup failures; this symlink is only a verifier convenience.
  }
}
