import { spawn } from "node:child_process";
import type { ExecutorTarget, ExecutorResult, ExecutorRun } from "./executor.js";

export interface SpawnResult { stdout: string; code: number; }
export type SpawnFn = (req: ExecutorRun) => Promise<SpawnResult>;

const realSpawn: SpawnFn = (req) =>
  new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn("codex", ["exec", "--cd", req.root, "-c", "approval_policy=\"never\"", "--sandbox", "workspace-write", req.prompt], { timeout: 1_800_000, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal !== null || code === null) {
        reject(new Error(`executor killed/timed out (signal=${signal}, code=${code}): ${stderr.slice(-500)}`));
        return;
      }
      resolve({ stdout, code });
    });
  });

function parse(stdout: string): ExecutorResult {
  const changedFiles = [...stdout.matchAll(/^CHANGED:\s*(.+)$/gm)].map((m) => m[1].trim());
  const testsPassed = /^TESTS:\s*pass/m.test(stdout);
  const failures = [...stdout.matchAll(/^FAILURE:\s*(.+)$/gm)].map((m) => m[1].trim());
  const diffStat = (stdout.match(/^DIFFSTAT:\s*(.+)$/m)?.[1] ?? "").trim();
  return { changedFiles, diffStat, testsPassed, failures, raw: stdout };
}

export function makeCodexTarget(spawnFn: SpawnFn = realSpawn): ExecutorTarget {
  return { name: "codex", async run(req) { const { stdout } = await spawnFn(req); return parse(stdout); } };
}
