import { spawn } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlannerBackend, PlannerAsk } from "./planner.js";

export type OracleSpawn = (args: { prompt: string; context: string; mode?: string }) => Promise<string>;

let ctxCounter = 0;

export function parseOracleAnswer(stdout: string): string {
  const lines = stdout.split(/\r?\n/);
  let answerIndex = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i]?.trim() === "Answer:") {
      answerIndex = i;
      break;
    }
  }

  if (answerIndex === -1) {
    return stdout.trim();
  }

  return lines
    .slice(answerIndex + 1)
    .join("\n")
    .replace(/\n\s*[\d.]+s\s+·\s+.*$/u, "")
    .trim();
}

const realSpawn: OracleSpawn = ({ prompt, context, mode }) =>
  new Promise<string>((resolve, reject) => {
    const tag = mode ? `[oracle:${mode}] ` : "";
    const ctxFile = join(tmpdir(), `gproj-oracle-ctx-${process.pid}-${++ctxCounter}.md`);
    const cleanup = () => {
      try {
        rmSync(ctxFile, { force: true });
      } catch {
        // Ignore cleanup failures so they do not mask the oracle result.
      }
    };

    writeFileSync(ctxFile, context);
    const child = spawn(
      "oracle",
      ["--render-plain", "--no-notify", "--no-notify-sound", "--file", ctxFile, "-p", `${tag}${prompt}`],
      { timeout: 1_500_000, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      cleanup();
      reject(err);
    });
    child.on("close", (code, signal) => {
      if (signal !== null || code !== 0) {
        cleanup();
        reject(new Error(`oracle-browser failed (signal=${signal}, code=${code}): ${stderr.slice(-500)}`));
        return;
      }
      const answer = parseOracleAnswer(stdout);
      cleanup();
      resolve(answer);
    });
  });

export function makeOracleBrowserBackend(spawnFn: OracleSpawn = realSpawn): PlannerBackend {
  return { name: "oracle-browser", async ask(req: PlannerAsk) { return spawnFn({ prompt: req.instruction, context: req.pack, mode: req.mode }); } };
}
