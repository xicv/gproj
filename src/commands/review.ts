import { buildContextPack } from "../assembler/pack.js";
import { getPlannerBackend } from "../backends/planner.js";
import { readState, writeState } from "../format/store.js";
import { existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { filePath, reviewPath } from "../format/paths.js";

export interface ReviewOpts { plannerName: string; maxTokens: number; }

function nextReviewIndex(root: string, phase: number): number {
  const dir = filePath(root, "reviews");
  if (!existsSync(dir)) return 1;
  const idxs = readdirSync(dir)
    .map((f) => f.match(new RegExp(`^p${phase}-v(\\d+)\\.md$`)))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => Number(m[1]));
  return (idxs.length ? Math.max(...idxs) : 0) + 1;
}

export async function runReview(root: string, opts: ReviewOpts): Promise<void> {
  const state = readState(root);
  if (!state) throw new Error("gproj not initialized");
  if (state.status !== "reviewing") {
    throw new Error(`nothing to review; run \`gproj exec\` first (status: ${state.status})`);
  }
  const phase = state.currentPhase;
  const pack = buildContextPack(root, phase, opts.maxTokens);
  const planner = getPlannerBackend(opts.plannerName);
  const verdict = await planner.ask({
    pack,
    instruction: `Review phase ${phase} from the evidence only (do NOT assume repo access). Answer: (1) goal met? (2) acceptance met? (3) over-engineered? (4) tests enough? (5) proceed to next phase?`,
    mode: "review",
  });
  const id = `p${phase}-v${nextReviewIndex(root, phase)}`;
  const p = reviewPath(root, id);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, verdict);
  writeState(root, { ...state, status: "deciding" });
}
