import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { RunSchema, StateSchema, type Run, type State } from "./schema.js";
import {
  ensureParentDir,
  filePath,
  goalPath,
  historyPath,
  phaseDir,
  phaseExecPromptPath,
  phaseNumber,
  phasePlanPath,
  phaseReviewPath,
  phaseRunPath,
  statePath,
  statusPath,
} from "./paths.js";

const ensureDir = (p: string) => mkdirSync(dirname(p), { recursive: true });
let tmpCounter = 0;
let migratedRoots = new Set<string>();

export function atomicWrite(path: string, data: string): void {
  const tmpPath = `${path}.tmp-${process.pid}-${++tmpCounter}`;
  try {
    ensureParentDir(path);
    writeFileSync(tmpPath, data);
    renameSync(tmpPath, path);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Best-effort cleanup must not hide the write/rename failure.
    }
    throw error;
  }
}

export function writeState(root: string, state: State): void {
  const p = statePath(root);
  ensureDir(p);
  atomicWrite(p, JSON.stringify(StateSchema.parse(state), null, 2));
  generateStatus(root);
}
export function readState(root: string): State | null {
  migrateLayout(root);
  const p = statePath(root);
  if (!existsSync(p)) return null;
  return StateSchema.parse(JSON.parse(readFileSync(p, "utf8")));
}
export function appendNdjson(root: string, rel: string, record: unknown): void {
  const p = filePath(root, rel);
  ensureDir(p);
  appendFileSync(p, JSON.stringify(record) + "\n", { flag: "a" });
}
export function readNdjson(root: string, rel: string): unknown[] {
  const p = filePath(root, rel);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
export function writeMarkdown(root: string, rel: string, body: string): void {
  const p = filePath(root, rel);
  ensureDir(p);
  atomicWrite(p, body);
}
export function readMarkdown(root: string, rel: string): string | null {
  migrateLayout(root);
  const p = filePath(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

export function writeMarkdownPath(path: string, body: string): void {
  atomicWrite(path, body);
}

export function readMarkdownPath(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function moveIfExists(from: string, to: string): boolean {
  if (!existsSync(from)) return false;
  ensureParentDir(to);
  if (existsSync(to)) {
    unlinkSync(from);
    return true;
  }
  renameSync(from, to);
  return true;
}

function phaseFromNN(name: string): number | null {
  const match = name.match(/^(\d+)\.md$/);
  return match ? Number(match[1]) : null;
}

function phasePackageFromName(name: string): { phase: number; packageId: number } | null {
  const match = name.match(/^p(\d+)-pkg(\d+)\.md$/);
  return match ? { phase: Number(match[1]), packageId: Number(match[2]) } : null;
}

function execPackageFromName(name: string): { phase: number; packageId: number } | null {
  const match = name.match(/^p(\d+)-pkg(\d+)-exec-prompt\.md$/);
  return match ? { phase: Number(match[1]), packageId: Number(match[2]) } : null;
}

function execNNFromName(name: string): number | null {
  const match = name.match(/^(\d+)-exec-prompt\.md$/);
  return match ? Number(match[1]) : null;
}

function oldRunFromName(name: string): { phase: number; index: number } | null {
  const match = name.match(/^p(\d+)-r(\d+)\.json$/);
  return match ? { phase: Number(match[1]), index: Number(match[2]) } : null;
}

function oldReviewFromName(name: string): { phase: number; index: number } | null {
  const match = name.match(/^p(\d+)-v(\d+)\.md$/);
  return match ? { phase: Number(match[1]), index: Number(match[2]) } : null;
}

function newestPlanFiles(root: string): Map<number, string> {
  const dir = filePath(root, "phases");
  const latest = new Map<number, { score: number; path: string }>();
  if (!existsSync(dir)) return new Map();
  for (const name of readdirSync(dir)) {
    const full = filePath(root, `phases/${name}`);
    const phase = phaseFromNN(name);
    if (phase !== null) {
      latest.set(phase, { score: 0, path: full });
      continue;
    }
    const pkg = phasePackageFromName(name);
    if (!pkg) continue;
    const existing = latest.get(pkg.phase);
    if (!existing || pkg.packageId >= existing.score) latest.set(pkg.phase, { score: pkg.packageId, path: full });
  }
  return new Map([...latest.entries()].map(([phase, item]) => [phase, item.path]));
}

function newestExecPromptFiles(root: string): Map<number, string> {
  const dir = filePath(root, "packages");
  const latest = new Map<number, { score: number; path: string }>();
  if (!existsSync(dir)) return new Map();
  for (const name of readdirSync(dir)) {
    const full = filePath(root, `packages/${name}`);
    const phase = execNNFromName(name);
    if (phase !== null) {
      latest.set(phase, { score: 0, path: full });
      continue;
    }
    const pkg = execPackageFromName(name);
    if (!pkg) continue;
    const existing = latest.get(pkg.phase);
    if (!existing || pkg.packageId >= existing.score) latest.set(pkg.phase, { score: pkg.packageId, path: full });
  }
  return new Map([...latest.entries()].map(([phase, item]) => [phase, item.path]));
}

export function migrateLayout(root: string): void {
  if (migratedRoots.has(root)) return;
  migratedRoots.add(root);

  moveIfExists(filePath(root, "project.md"), goalPath(root));
  moveIfExists(filePath(root, "journal.ndjson"), historyPath(root));

  for (const [phase, from] of newestPlanFiles(root)) moveIfExists(from, phasePlanPath(root, phase));
  const oldPhasesDir = filePath(root, "phases");
  if (existsSync(oldPhasesDir)) {
    for (const name of readdirSync(oldPhasesDir)) {
      const oldFile = filePath(root, `phases/${name}`);
      if (phaseFromNN(name) !== null || phasePackageFromName(name)) unlinkSync(oldFile);
    }
  }

  for (const [phase, from] of newestExecPromptFiles(root)) moveIfExists(from, phaseExecPromptPath(root, phase));
  const oldPackagesDir = filePath(root, "packages");
  if (existsSync(oldPackagesDir)) rmSync(oldPackagesDir, { recursive: true, force: true });

  const oldRunsDir = filePath(root, "runs");
  if (existsSync(oldRunsDir)) {
    for (const name of readdirSync(oldRunsDir)) {
      const old = oldRunFromName(name);
      if (old) moveIfExists(filePath(root, `runs/${name}`), phaseRunPath(root, old.phase, old.index));
    }
    rmSync(oldRunsDir, { recursive: true, force: true });
  }

  const oldReviewsDir = filePath(root, "reviews");
  if (existsSync(oldReviewsDir)) {
    for (const name of readdirSync(oldReviewsDir)) {
      const old = oldReviewFromName(name);
      if (old) moveIfExists(filePath(root, `reviews/${name}`), phaseReviewPath(root, old.phase, old.index));
    }
    rmSync(oldReviewsDir, { recursive: true, force: true });
  }
}

function latestRunForStatus(root: string, phase: number): Run | null {
  const dir = phaseDir(root, phase);
  if (!existsSync(dir)) return null;
  const runs = readdirSync(dir)
    .map((name) => {
      const match = name.match(/^run-(\d+)\.json$/);
      return match ? { index: Number(match[1]), name } : null;
    })
    .filter((run): run is { index: number; name: string } => run !== null)
    .sort((a, b) => b.index - a.index);
  for (const run of runs) {
    try {
      return RunSchema.parse(JSON.parse(readFileSync(phaseRunPath(root, phase, run.index), "utf8")));
    } catch {
      // Skip corrupt run evidence in the human summary; schema validation still happens in command paths.
    }
  }
  return null;
}

function runVerdict(run: Run | null): string {
  if (!run) return "no run";
  if (run.verifierStatus === "unverified") return "UNVERIFIED";
  if (run.verifierStatus === "verified") return "PASS";
  if (run.verifierStatus === "failed") return "FAIL";
  return run.verifierPassed ? "PASS" : "FAIL";
}

export function generateStatus(root: string): void {
  migrateLayout(root);
  const stateFile = statePath(root);
  if (!existsSync(stateFile)) return;
  const state = StateSchema.parse(JSON.parse(readFileSync(stateFile, "utf8")));
  const phaseIds = new Set<number>(state.phases.map((phase) => phase.id));
  phaseIds.add(state.currentPhase);
  if (existsSync(filePath(root, "phases"))) {
    for (const name of readdirSync(filePath(root, "phases"))) {
      const match = name.match(/^(\d+)$/);
      if (match) phaseIds.add(Number(match[1]));
    }
  }

  const lines = [
    "# gproj Status",
    "",
    `Current phase: ${state.currentPhase}`,
    `Status: ${state.status}`,
    `Latest run: ${runVerdict(latestRunForStatus(root, state.currentPhase))}`,
    "",
    "## Phases",
    "",
  ];

  for (const id of [...phaseIds].sort((a, b) => a - b)) {
    const phase = state.phases.find((p) => p.id === id);
    const marker = id < state.currentPhase || phase?.status === "accepted" ? "✓" : id === state.currentPhase ? "▶" : "·";
    const title = phase?.title ?? `phase ${id}`;
    const status = phase?.status ?? "pending";
    lines.push(`- ${marker} Phase ${phaseNumber(id)}: ${title} (${status}); last run: ${runVerdict(latestRunForStatus(root, id))}`);
  }

  lines.push("");
  atomicWrite(statusPath(root), `${lines.join("\n")}\n`);
}
