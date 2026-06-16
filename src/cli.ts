#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { runInit } from "./commands/init.js";
import { renderStatus } from "./commands/status.js";
import { withLock } from "./lock/lock.js";
import { loadConfig } from "./config/projectConfig.js";

interface CliIo {
  log: (line: string) => void;
  error: (line: string) => void;
}

class CliExit extends Error {
  constructor(public readonly code: number) {
    super("cli exit");
  }
}

function plannerName(root: string, env: NodeJS.ProcessEnv): string {
  return env.GPROJ_PLANNER ?? loadConfig(root).plannerBackend ?? "oracle-browser";
}

function executorName(root: string, env: NodeJS.ProcessEnv): string {
  return env.GPROJ_EXECUTOR ?? loadConfig(root).executorBackend ?? "stub";
}

function maxTokens(root: string, env: NodeJS.ProcessEnv): number {
  return Number(env.GPROJ_MAX_TOKENS ?? loadConfig(root).maxPackTokens ?? 6000);
}

export async function runCli(
  root: string,
  args: string[],
  io: CliIo = { log: console.log, error: console.error },
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const { positionals } = parseArgs({ allowPositionals: true, args });
  const [cmd, ...rest] = positionals;
  switch (cmd) {
    case "init": {
      const goal = rest.join(" ");
      if (!goal) { io.error("usage: gproj init \"<goal>\""); throw new CliExit(2); }
      io.log(await withLock(root, "init", () => {
        runInit(root, goal);
        return renderStatus(root);
      }));
      break;
    }
    case "status":
      io.log(renderStatus(root));
      break;
    case "doctor": {
      const { renderDoctor } = await import("./commands/doctor.js");
      io.log(renderDoctor(root));
      break;
    }
    case "recover": {
      const { runRecover } = await import("./commands/recover.js");
      const summary = await runRecover(root);
      io.log([
        `interrupted: ${summary.interrupted}`,
        `actions: ${summary.actions.length ? summary.actions.join(", ") : "none"}`,
        `recommendation: ${summary.recommendation}`,
      ].join("\n"));
      break;
    }
    case "package": {
      const { runPackage } = await import("./commands/package.js");
      io.log(await withLock(root, "package", async () => {
        await runPackage(root, { plannerName: plannerName(root, env), maxTokens: maxTokens(root, env) });
        return renderStatus(root);
      }));
      break;
    }
    case "exec": {
      const { runExec } = await import("./commands/exec.js");
      const { id, status } = await withLock(root, "exec", async () => {
        const runId = await runExec(root, { executorName: executorName(root, env) });
        return { id: runId, status: renderStatus(root) };
      });
      io.log(`run recorded: ${id}`);
      io.log(status);
      break;
    }
    case "review": {
      const { runReview } = await import("./commands/review.js");
      io.log(await withLock(root, "review", async () => {
        await runReview(root, { plannerName: plannerName(root, env), maxTokens: maxTokens(root, env) });
        return renderStatus(root);
      }));
      break;
    }
    case "decide": {
      const { runDecide } = await import("./commands/decide.js");
      const d = rest[0] as "accept" | "adjust" | "reject";
      io.log(await withLock(root, "decide", () => {
        runDecide(root, d);
        return renderStatus(root);
      }));
      break;
    }
    case "advance": {
      const { runAdvance } = await import("./commands/advance.js");
      io.log(await withLock(root, "advance", async () => {
        await runAdvance(root, {
          plannerName: plannerName(root, env),
          executorName: executorName(root, env),
          maxTokens: maxTokens(root, env),
        });
        return renderStatus(root);
      }));
      break;
    }
    default:
      io.error(`gproj: unknown command "${cmd ?? ""}". commands: init, status, doctor, recover, package, exec, review, decide, advance`);
      throw new CliExit(2);
  }
}

async function main(): Promise<void> {
  await runCli(process.cwd(), process.argv.slice(2));
}

const entry = process.argv[1];
if (entry) {
  let entryReal: string;
  try {
    entryReal = realpathSync(resolve(entry));
  } catch {
    entryReal = resolve(entry);
  }

  if (fileURLToPath(import.meta.url) === entryReal) {
    main().catch((e) => {
      if (e instanceof CliExit) process.exit(e.code);
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    });
  }
}
