export interface PlannerAsk { pack: string; instruction: string; mode?: string; }
export interface PlannerBackend { name: string; ask(req: PlannerAsk): Promise<string>; }

const stub: PlannerBackend = { name: "stub", async ask(req) { return `STUB PLAN\n${req.instruction}\n---\n${req.pack}`; } };

export function getPlannerBackend(name: string): PlannerBackend {
  const registry: Record<string, PlannerBackend> = { stub };
  const b = registry[name];
  if (!b) throw new Error(`unknown planner backend: ${name}`);
  return b;
}
