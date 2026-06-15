import { spawn } from "node:child_process";
import type { ExecutorTarget, ExecutorResult } from "./executor.js";
import type { SpawnFn, SpawnResult } from "./codex.js";

const realSpawn: SpawnFn = (req) =>
  new Promise<SpawnResult>((resolve, reject) => {
    // SECURITY: no bypassPermissions by default; sandbox/allowed-tools is Phase 6.
    const child = spawn("claude", ["-p", "--output-format", "json", req.prompt], { cwd: req.root, timeout: 1_800_000 });
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
  let body = stdout;
  try { const j = JSON.parse(stdout) as { result?: string }; if (typeof j.result === "string") body = j.result; } catch { /* plain text */ }
  const changedFiles = [...body.matchAll(/^CHANGED:\s*(.+)$/gm)].map((m) => m[1].trim());
  const testsPassed = /^TESTS:\s*pass/m.test(body);
  const failures = [...body.matchAll(/^FAILURE:\s*(.+)$/gm)].map((m) => m[1].trim());
  const diffStat = (body.match(/^DIFFSTAT:\s*(.+)$/m)?.[1] ?? "").trim();
  return { changedFiles, diffStat, testsPassed, failures, raw: stdout };
}

export function makeClaudeCodeTarget(spawnFn: SpawnFn = realSpawn): ExecutorTarget {
  return { name: "claude-code", async run(req) { const { stdout } = await spawnFn(req); return parse(stdout); } };
}
