import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { getExecutorTarget } from "../backends/executor.js";
import { readState, writeState, readMarkdown } from "../format/store.js";
import { filePath } from "../format/paths.js";
import { ingestRun } from "./ingestRun.js";

export interface ExecOpts { executorName: string; }

function nextRunIndex(root: string, phase: number): number {
  const dir = filePath(root, "runs");
  if (!existsSync(dir)) return 1;
  const idxs = readdirSync(dir)
    .map((f) => f.match(new RegExp(`^p${phase}-r(\\d+)\\.json$`)))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => Number(m[1]));
  return (idxs.length ? Math.max(...idxs) : 0) + 1;
}

export async function runExec(root: string, opts: ExecOpts): Promise<string> {
  const state = readState(root);
  if (!state) throw new Error("gproj not initialized");
  if (state.status !== "packaged") {
    throw new Error(`no packaged phase to execute; run \`gproj package\` first (status: ${state.status})`);
  }
  const phase = state.currentPhase;
  const prompt = readMarkdown(root, `packages/${String(phase).padStart(2, "0")}-exec-prompt.md`);
  if (!prompt) throw new Error(`no exec prompt for phase ${phase}; run \`gproj package\` first`);
  const target = getExecutorTarget(opts.executorName);
  const result = await target.run({ root, phase, prompt });
  const id = `p${phase}-r${nextRunIndex(root, phase)}`;
  ingestRun(root, { id, phase, promptHash: createHash("sha1").update(prompt).digest("hex").slice(0, 12), changedFiles: result.changedFiles, diffStat: result.diffStat, testsPassed: result.testsPassed, failures: result.failures });
  writeState(root, { ...state, status: "reviewing" });
  return id;
}
