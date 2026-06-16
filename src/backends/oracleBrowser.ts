import { spawn } from "node:child_process";
import type { PlannerBackend, PlannerAsk } from "./planner.js";

export type OracleSpawn = (args: { prompt: string; context: string; mode?: string }) => Promise<string>;

const realSpawn: OracleSpawn = ({ prompt, context, mode }) =>
  new Promise<string>((resolve, reject) => {
    const tag = mode ? `[oracle:${mode}] ` : "";
    // pack size is bounded by maxPackTokens + PACK_TOO_LARGE (Phase 6d-1), so argv ARG_MAX is not a practical risk here
    const child = spawn("oracle", ["--context", context, `${tag}${prompt}`], { timeout: 1_500_000 });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal !== null || code !== 0) {
        reject(new Error(`oracle-browser failed (signal=${signal}, code=${code}): ${stderr.slice(-500)}`));
        return;
      }
      resolve(stdout);
    });
  });

export function makeOracleBrowserBackend(spawnFn: OracleSpawn = realSpawn): PlannerBackend {
  return { name: "oracle-browser", async ask(req: PlannerAsk) { return spawnFn({ prompt: req.instruction, context: req.pack, mode: req.mode }); } };
}
