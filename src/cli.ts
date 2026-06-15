#!/usr/bin/env node
import { parseArgs } from "node:util";
import { runInit } from "./commands/init.js";
import { renderStatus } from "./commands/status.js";

async function main(): Promise<void> {
  const { positionals } = parseArgs({ allowPositionals: true, args: process.argv.slice(2) });
  const [cmd, ...rest] = positionals;
  const root = process.cwd();
  switch (cmd) {
    case "init": {
      const goal = rest.join(" ");
      if (!goal) { console.error("usage: gproj init \"<goal>\""); process.exit(2); }
      runInit(root, goal);
      console.log(renderStatus(root));
      break;
    }
    case "status":
      console.log(renderStatus(root));
      break;
    case "package": {
      const { runPackage } = await import("./commands/package.js");
      await runPackage(root, { plannerName: process.env.GPROJ_PLANNER ?? "stub", maxTokens: Number(process.env.GPROJ_MAX_TOKENS ?? 6000) });
      console.log(renderStatus(root));
      break;
    }
    case "exec": {
      const { runExec } = await import("./commands/exec.js");
      const id = await runExec(root, { executorName: process.env.GPROJ_EXECUTOR ?? "stub" });
      console.log(`run recorded: ${id}`);
      console.log(renderStatus(root));
      break;
    }
    case "review": {
      const { runReview } = await import("./commands/review.js");
      await runReview(root, { plannerName: process.env.GPROJ_PLANNER ?? "stub", maxTokens: Number(process.env.GPROJ_MAX_TOKENS ?? 6000) });
      console.log(renderStatus(root));
      break;
    }
    case "decide": {
      const { runDecide } = await import("./commands/decide.js");
      const d = rest[0] as "accept" | "adjust" | "reject";
      runDecide(root, d);
      console.log(renderStatus(root));
      break;
    }
    case "advance": {
      const { runAdvance } = await import("./commands/advance.js");
      await runAdvance(root, {
        plannerName: process.env.GPROJ_PLANNER ?? "stub",
        executorName: process.env.GPROJ_EXECUTOR ?? "stub",
        maxTokens: Number(process.env.GPROJ_MAX_TOKENS ?? 6000),
      });
      console.log(renderStatus(root));
      break;
    }
    default:
      console.error(`gproj: unknown command "${cmd ?? ""}". commands: init, status, package, exec, review, decide, advance`);
      process.exit(2);
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
