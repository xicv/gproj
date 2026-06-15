import { spawn } from "node:child_process";
import type { PlannerBackend, PlannerAsk } from "./planner.js";

export type OracleSpawn = (args: { prompt: string; context: string; mode?: string }) => Promise<string>;

const realSpawn: OracleSpawn = ({ prompt, context, mode }) =>
  new Promise<string>((resolve, reject) => {
    const tag = mode ? `[oracle:${mode}] ` : "";
    const child = spawn("oracle", ["--context", context, `${tag}${prompt}`], { timeout: 1_500_000 });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.on("error", reject);
    child.on("close", () => resolve(stdout));
  });

export function makeOracleBrowserBackend(spawnFn: OracleSpawn = realSpawn): PlannerBackend {
  return { name: "oracle-browser", async ask(req: PlannerAsk) { return spawnFn({ prompt: req.instruction, context: req.pack, mode: req.mode }); } };
}
