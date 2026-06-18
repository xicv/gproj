import { spawn } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlannerUnavailableError, type PlannerBackend, type PlannerAsk } from "./planner.js";

export type OracleSpawnArgs = { prompt: string; context: string; mode?: string };
export type OracleSpawn = (args: OracleSpawnArgs) => Promise<string>;
export type OracleRun = (args: OracleSpawnArgs, strategy: string) => Promise<string>;

let ctxCounter = 0;

const UNAVAILABLE_MARKERS = [
  "unable to locate the chatgpt model selector",
  "resolved=(unavailable)",
  "usage limit",
  "rate limit",
  "try again later",
  "you have reached",
  "model is at capacity",
];

export function looksUnavailable(text: string): boolean {
  const t = text.toLowerCase();
  return UNAVAILABLE_MARKERS.some((m) => t.includes(m));
}

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

function unavailableFlag(error: unknown): boolean {
  return typeof error === "object" && error !== null && "unavailable" in error && (error as { unavailable?: unknown }).unavailable === true;
}

export function oracleArgv(ctxFile: string, prompt: string, strategy: string): string[] {
  return ["--render-plain", "--no-notify", "--no-notify-sound", "--browser-model-strategy", strategy, "--file", ctxFile, "-p", prompt];
}

export const runOracle: OracleRun = ({ prompt, context, mode }, strategy) =>
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
      oracleArgv(ctxFile, `${tag}${prompt}`, strategy),
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
        const detail = [stdout.slice(-800), stderr.slice(-800)].filter(Boolean).join("\n").trim();
        const err = new Error(`oracle-browser failed (signal=${signal}, code=${code}): ${detail}`);
        if (looksUnavailable(detail)) (err as { unavailable?: boolean }).unavailable = true;
        reject(err);
        return;
      }
      const answer = parseOracleAnswer(stdout);
      cleanup();
      resolve(answer);
    });
  });

export function makeResilientOracleSpawn(run: OracleRun = runOracle): OracleSpawn {
  return async (args) => {
    const strategy = process.env.GPROJ_ORACLE_MODEL_STRATEGY ?? "select";
    try {
      return await run(args, strategy);
    } catch (firstErr) {
      if (!unavailableFlag(firstErr)) throw firstErr;
      if (strategy === "current") {
        throw new PlannerUnavailableError(firstErr instanceof Error ? firstErr.message : String(firstErr));
      }
      try {
        return await run(args, "current");
      } catch (secondErr) {
        if (unavailableFlag(secondErr)) {
          throw new PlannerUnavailableError(secondErr instanceof Error ? secondErr.message : String(secondErr));
        }
        throw secondErr;
      }
    }
  };
}

export const realSpawn: OracleSpawn = makeResilientOracleSpawn();

export function makeOracleBrowserBackend(spawnFn: OracleSpawn = realSpawn): PlannerBackend {
  return {
    name: "oracle-browser",
    async ask(req: PlannerAsk) {
      // The oracle CLI relaunches a Chrome session (fixed debug port) per call;
      // back-to-back calls (package() makes two) can transiently collide while
      // the previous browser/port tears down. Retry once after a short delay so
      // the prior session fully releases before surfacing the failure.
      const attempt = () => spawnFn({ prompt: req.instruction, context: req.pack, mode: req.mode });
      try {
        return await attempt();
      } catch (firstErr) {
        if (firstErr instanceof PlannerUnavailableError) throw firstErr;
        await new Promise((resolve) => setTimeout(resolve, 8000));
        try {
          return await attempt();
        } catch {
          throw firstErr;
        }
      }
    },
  };
}
