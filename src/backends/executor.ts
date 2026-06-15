export interface ExecutorRun { root: string; phase: number; prompt: string; }
export interface ExecutorResult { changedFiles: string[]; diffStat: string; testsPassed: boolean; failures: string[]; raw: string; }
export interface ExecutorTarget { name: string; run(req: ExecutorRun): Promise<ExecutorResult>; }

const stub: ExecutorTarget = {
  name: "stub",
  async run() { return { changedFiles: [], diffStat: "+0 -0", testsPassed: true, failures: [], raw: "stub run" }; },
};

export function getExecutorTarget(name: string): ExecutorTarget {
  const registry: Record<string, ExecutorTarget> = { stub };
  const t = registry[name];
  if (!t) throw new Error(`unknown executor target: ${name}`);
  return t;
}
