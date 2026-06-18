import { z } from "zod";

export const ResourceRelationSchema = z.enum(["defines", "references", "relates-to", "depends-on"]);
export const ResourceLinkSchema = z.object({
  rel: ResourceRelationSchema,
  toId: z.string(),
}).strict();

export const ResourceOwnsSchema = z.object({
  symbols: z.array(z.string()),
  endpoints: z.array(z.string()),
  configKeys: z.array(z.string()),
}).strict();

export const ResourceEnvironmentSchema = z.object({
  db: z.array(z.string()).optional(),
  services: z.array(z.string()).optional(),
  mcp: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  urls: z.array(z.string()).optional(),
}).strict();

export const ResourceCaptureMetaSchema = z.object({
  sessionId: z.string(),
  fingerprint: z.string(),
  toolSequence: z.array(z.string()),
  capturedAt: z.string(),
}).strict();

export const ResourceCardSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  timestamp: z.string(),
  description: z.string().optional(),
  resource: z.string().optional(),
  body: z.string().optional(),
  excerpt: z.string().optional(),
  sourcePaths: z.array(z.string()).optional(),
  contentHash: z.string().optional(),
  contentSize: z.number().int().nonnegative().optional(),
  links: z.array(ResourceLinkSchema).optional(),
  intent: z.string().optional(),
  owns: ResourceOwnsSchema.optional(),
  schemaSource: z.array(z.string()).optional(),
  enrichedAt: z.string().datetime().optional(),
  kind: z.enum(["debug", "research", "feature", "reference"]).optional(),
  facts: z.array(z.string()).optional(),
  environment: ResourceEnvironmentSchema.optional(),
  repro: z.array(z.string()).optional(),
  resolution: z.string().optional(),
  triggers: z.array(z.string()).optional(),
  visibility: z.enum(["local", "shared"]).optional(),
  captureMeta: ResourceCaptureMetaSchema.optional(),
}).strict();

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
export const VerifierStatusSchema = z.enum(["verified", "failed", "unverified"]);
export const RunSchema = z.object({
  id: z.string(), phase: z.number().int().positive(), promptHash: z.string(),
  changedFiles: z.array(z.string()), diffStat: z.string(), testsPassed: z.boolean(), failures: z.array(z.string()),
  baseHead: z.string().nullable().default(null),
  postHead: z.string().nullable().default(null),
  verifierStatus: VerifierStatusSchema.optional(),
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
export type ResourceCard = z.infer<typeof ResourceCardSchema>;
export type ResourceLink = z.infer<typeof ResourceLinkSchema>;
export type ResourceRelation = z.infer<typeof ResourceRelationSchema>;
export type ResourceOwns = z.infer<typeof ResourceOwnsSchema>;
export type ResourceEnvironment = z.infer<typeof ResourceEnvironmentSchema>;
export type ResourceCaptureMeta = z.infer<typeof ResourceCaptureMetaSchema>;
