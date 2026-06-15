import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { RunSchema, type Run } from "../format/schema.js";
import { runPath } from "../format/paths.js";
import { atomicWrite } from "../format/store.js";

export function ingestRun(root: string, run: Run): void {
  const validated = RunSchema.parse(run);
  const p = runPath(root, validated.id);
  mkdirSync(dirname(p), { recursive: true });
  atomicWrite(p, JSON.stringify(validated, null, 2));
}
