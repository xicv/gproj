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

function parsePorcelain(output: string): { path: string; status: string }[] {
  if (output.length === 0) return [];
  return output.split("\n").filter(Boolean).map((line) => {
    const status = line.slice(0, 2).trim() || line.slice(0, 2);
    const path = line.slice(3);
    return { status, path };
  });
}
