import { z } from "zod";

export const PhaseMetaSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  status: z.enum(["pending", "planned", "executing", "reviewing", "accepted", "rejected"]),
});

export const StateSchema = z.object({
  currentPhase: z.number().int().positive(),
  status: z.enum(["init", "planning", "packaged", "executing", "reviewing", "deciding", "done"]),
  phases: z.array(PhaseMetaSchema),
  activeWorktree: z.string().nullable().default(null),
  packageId: z.number().int().default(0),
});

export const DecisionSchema = z.object({ ts: z.string(), title: z.string(), why: z.string() });
export const KnownIssueSchema = z.object({ ts: z.string(), issue: z.string(), severity: z.enum(["low", "medium", "high"]).default("medium") });
export const RunSchema = z.object({
  id: z.string(), phase: z.number().int().positive(), promptHash: z.string(),
  changedFiles: z.array(z.string()), diffStat: z.string(), testsPassed: z.boolean(), failures: z.array(z.string()),
  baseHead: z.string().nullable().default(null),
  postHead: z.string().nullable().default(null),
  verifierPassed: z.boolean().default(false),
  verifierFailures: z.array(z.string()).default([]),
  // The TRUSTED checks gproj ran itself (command + outcome). Distinct from
  // executorClaims; this is what the reviewer should base its verdict on.
  verifierChecks: z.array(z.object({
    command: z.string(),
    passed: z.boolean(),
    exitCode: z.number().nullable(),
  })).default([]),
  // Bounded patch of the sandboxed change, captured at exec time so the
  // reviewer can read the actual code instead of inferring from a file list.
  diff: z.string().default(""),
  packageId: z.number().int().default(0),
  executorClaims: z.object({
    changedFiles: z.array(z.string()),
    testsPassed: z.boolean().optional(),
    diffStat: z.string().optional(),
    failures: z.array(z.string()),
  }).optional(),
});

export type State = z.infer<typeof StateSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type KnownIssue = z.infer<typeof KnownIssueSchema>;
export type Run = z.infer<typeof RunSchema>;
export type PhaseMeta = z.infer<typeof PhaseMetaSchema>;
