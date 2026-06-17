import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export const gprojDir = (root: string) => join(root, ".gproj");
export const filePath = (root: string, rel: string) => join(gprojDir(root), rel);

export const phaseNumber = (phase: number) => String(phase).padStart(2, "0");
export const ensureParentDir = (path: string): void => {
  mkdirSync(dirname(path), { recursive: true });
};

export const goalPath = (root: string) => filePath(root, "GOAL.md");
export const statusPath = (root: string) => filePath(root, "STATUS.md");
export const historyPath = (root: string) => filePath(root, "history.ndjson");
export const resourcesManifestPath = (root: string) => filePath(root, "resources.ndjson");
export const resourcesBundleDir = (root: string) => filePath(root, "resources");
export const resourceAssetDir = (root: string) => join(resourcesBundleDir(root), "_assets");
export const statePath = (root: string) => filePath(root, "state.json");
export const configPath = (root: string) => filePath(root, "config.json");
export const phaseDir = (root: string, phase: number) => filePath(root, `phases/${phaseNumber(phase)}`);
export const phasePlanPath = (root: string, phase: number) => join(phaseDir(root, phase), "plan.md");
export const phaseExecPromptPath = (root: string, phase: number) => join(phaseDir(root, phase), "exec-prompt.md");
export const phaseRunPath = (root: string, phase: number, idx: number) => join(phaseDir(root, phase), `run-${idx}.json`);
export const phaseReviewPath = (root: string, phase: number, idx: number) => join(phaseDir(root, phase), `review-${idx}.md`);
export const phaseDecisionPath = (root: string, phase: number) => join(phaseDir(root, phase), "decision.md");
