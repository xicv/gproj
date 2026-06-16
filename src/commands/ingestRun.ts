import { RunSchema, type Run } from "../format/schema.js";
import { phaseRunPath } from "../format/paths.js";
import { atomicWrite } from "../format/store.js";

export function ingestRun(root: string, run: Run): void {
  const validated = RunSchema.parse(run);
  const match = validated.id.match(/^p\d+-r(\d+)$/);
  const p = phaseRunPath(root, validated.phase, match ? Number(match[1]) : 1);
  atomicWrite(p, JSON.stringify(validated, null, 2));
}
