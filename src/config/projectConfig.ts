import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { configPath } from "../format/paths.js";
import { z } from "zod";

const CommandSchema = z.array(z.string()).min(1);

export const GprojConfigSchema = z.object({
  testCommand: CommandSchema.optional(),
  typecheckCommand: CommandSchema.optional(),
  plannerBackend: z.string().default("oracle-browser"),
  executorBackend: z.string().default("codex"),
  plannerModel: z.string().optional(),
  maxPackTokens: z.number().default(6000),
  sandbox: z.object({
    mode: z.enum(["none", "worktree"]).default("worktree"),
  }).default({ mode: "worktree" }),
  redactions: z.array(z.string()).default([]),
  cloudSync: z.object({
    enabled: z.boolean().optional(),
    chatgptUrl: z.string().optional(),
    include: z.array(z.string()).optional(),
  }).optional(),
});

export type GprojConfig = z.infer<typeof GprojConfigSchema>;

export const DEFAULT_TEST_COMMAND = ["npx", "vitest", "run"] as const;
export const DEFAULT_TYPECHECK_COMMAND = ["npx", "tsc", "--noEmit"] as const;

export function defaultVerificationConfig(): Pick<GprojConfig, "testCommand" | "typecheckCommand"> {
  return {
    testCommand: [...DEFAULT_TEST_COMMAND],
    typecheckCommand: [...DEFAULT_TYPECHECK_COMMAND],
  };
}

export function projectConfigExists(root: string): boolean {
  return existsSync(configPath(root));
}

export function ensureDefaultConfig(root: string): void {
  const p = configPath(root);
  if (existsSync(p)) return;
  const cfg = GprojConfigSchema
    .pick({ testCommand: true, typecheckCommand: true })
    .parse(defaultVerificationConfig());
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(cfg, null, 2)}\n`);
}

export function loadConfig(root: string): GprojConfig {
  const p = configPath(root);
  if (!existsSync(p)) return GprojConfigSchema.parse({});
  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    throw new Error(`invalid .gproj/config.json: ${e instanceof Error ? e.message : String(e)}`);
  }
  return GprojConfigSchema.parse(rawConfig);
}
