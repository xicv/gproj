import { existsSync, readFileSync } from "node:fs";
import { filePath } from "../format/paths.js";
import { z } from "zod";

export const GprojConfigSchema = z.object({
  testCommand: z.array(z.string()).optional(),
  typecheckCommand: z.array(z.string()).optional(),
  plannerBackend: z.string().default("oracle-browser"),
  executorBackend: z.string().default("codex"),
  plannerModel: z.string().optional(),
  maxPackTokens: z.number().default(6000),
  sandbox: z.object({
    mode: z.enum(["none", "worktree"]).default("worktree"),
  }).default({ mode: "worktree" }),
  redactions: z.array(z.string()).default([]),
});

export type GprojConfig = z.infer<typeof GprojConfigSchema>;

export function loadConfig(root: string): GprojConfig {
  const p = filePath(root, "config.json");
  if (!existsSync(p)) return GprojConfigSchema.parse({});
  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    throw new Error(`invalid .gproj/config.json: ${e instanceof Error ? e.message : String(e)}`);
  }
  return GprojConfigSchema.parse(rawConfig);
}
