import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { ensureParentDir, resourcesResolutionsPath } from "../format/paths.js";

export const ConflictPreferenceSchema = z.enum(["code", "doc"]);
export type ConflictPreference = z.infer<typeof ConflictPreferenceSchema>;

export const ConflictResolutionSchema = z.object({
  id: z.string().min(1),
  prefer: ConflictPreferenceSchema,
  fingerprint: z.string().min(1),
  resolvedAt: z.string(),
}).strict();
export type ConflictResolution = z.infer<typeof ConflictResolutionSchema>;

export function readResolutions(root: string): ConflictResolution[] {
  const path = resourcesResolutionsPath(root);
  if (!existsSync(path)) return [];
  const resolutions: ConflictResolution[] = [];
  const lines = readFileSync(path, "utf8").split(/\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${path}: line ${index + 1}: invalid JSON: ${message}`);
    }
    const parsed = ConflictResolutionSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`${path}: line ${index + 1}: invalid resolution`);
    }
    resolutions.push(parsed.data);
  }
  return resolutions;
}

export function appendResolution(root: string, resolution: ConflictResolution): void {
  const validated = ConflictResolutionSchema.parse(resolution);
  const path = resourcesResolutionsPath(root);
  ensureParentDir(path);
  appendFileSync(path, `${JSON.stringify(validated)}\n`);
}

// Latest record per (id, fingerprint) wins.
export function preferenceFor(
  resolutions: ConflictResolution[],
  id: string,
  fingerprint: string,
): ConflictPreference | undefined {
  let prefer: ConflictPreference | undefined;
  for (const resolution of resolutions) {
    if (resolution.id === id && resolution.fingerprint === fingerprint) prefer = resolution.prefer;
  }
  return prefer;
}
