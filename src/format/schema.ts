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
});

export const DecisionSchema = z.object({ ts: z.string(), title: z.string(), why: z.string() });
export const KnownIssueSchema = z.object({ ts: z.string(), issue: z.string(), severity: z.enum(["low", "medium", "high"]).default("medium") });
export const RunSchema = z.object({
  id: z.string(), phase: z.number().int().positive(), promptHash: z.string(),
  changedFiles: z.array(z.string()), diffStat: z.string(), testsPassed: z.boolean(), failures: z.array(z.string()),
});

export type State = z.infer<typeof StateSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type KnownIssue = z.infer<typeof KnownIssueSchema>;
export type Run = z.infer<typeof RunSchema>;
export type PhaseMeta = z.infer<typeof PhaseMetaSchema>;
