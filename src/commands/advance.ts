import { runPackage } from "./package.js";
import { runExec } from "./exec.js";
import { runReview } from "./review.js";

export interface AdvanceOpts { plannerName: string; executorName: string; maxTokens: number; }

export async function runAdvance(root: string, opts: AdvanceOpts): Promise<void> {
  await runPackage(root, { plannerName: opts.plannerName, maxTokens: opts.maxTokens });
  await runExec(root, { executorName: opts.executorName });
  await runReview(root, { plannerName: opts.plannerName, maxTokens: opts.maxTokens });
  // stops at status "deciding" — human runs `gproj decide`
}
