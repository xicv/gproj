export interface CatalogEntry {
  name: string;
  group: string;
  summary: string;
  whenToUse: string;
  usage: string;
  example: string;
}

export const catalogEntries: CatalogEntry[] = [
  {
    name: "init",
    group: "project",
    summary: "Create the .gproj store and initial goal.",
    whenToUse: "Start tracking a new project goal with gproj.",
    usage: 'gproj init "<goal>"',
    example: 'gproj init "Ship the onboarding flow"',
  },
  {
    name: "status",
    group: "project",
    summary: "Print current project state.",
    whenToUse: "Inspect the current goal, phase, and latest workflow status.",
    usage: "gproj status",
    example: "gproj status",
  },
  {
    name: "doctor",
    group: "project",
    summary: "Check local gproj state for obvious issues.",
    whenToUse: "Diagnose whether the project store and generated files look healthy.",
    usage: "gproj doctor",
    example: "gproj doctor",
  },
  {
    name: "recover",
    group: "project",
    summary: "Recover from interrupted workflow state.",
    whenToUse: "Inspect and clear interrupted gproj lock or run state.",
    usage: "gproj recover",
    example: "gproj recover",
  },
  {
    name: "retarget",
    group: "project",
    summary: "Pivot to a new goal and start a fresh planning phase.",
    whenToUse: "Replace the current GOAL.md while preserving history and decisions from the previous goal.",
    usage: 'gproj retarget "<new goal>"',
    example: 'gproj retarget "Ship the import flow"',
  },
  {
    name: "package",
    group: "workflow",
    summary: "Generate the next execution prompt package.",
    whenToUse: "Prepare a focused implementation prompt from the current goal and evidence.",
    usage: "gproj package",
    example: "gproj package",
  },
  {
    name: "exec",
    group: "workflow",
    summary: "Run the configured executor and record evidence.",
    whenToUse: "Execute the current package with the configured agent backend.",
    usage: "gproj exec",
    example: "GPROJ_EXECUTOR=codex gproj exec",
  },
  {
    name: "review",
    group: "workflow",
    summary: "Ask the planner to review the latest run evidence.",
    whenToUse: "Evaluate a completed run before deciding whether to accept or adjust.",
    usage: "gproj review",
    example: "gproj review",
  },
  {
    name: "decide",
    group: "workflow",
    summary: "Record the human decision after review.",
    whenToUse: "Accept, adjust, or reject the reviewed run outcome.",
    usage: "gproj decide accept|adjust|reject",
    example: "gproj decide accept",
  },
  {
    name: "advance",
    group: "workflow",
    summary: "Run the next package, execution, and review step.",
    whenToUse: "Continue the planner-brain loop until the next human gate.",
    usage: "gproj advance",
    example: "gproj advance",
  },
  {
    name: "sync",
    group: "sync",
    summary: "Synchronize selected gproj state with cloud storage.",
    whenToUse: "Push or pull configured project state through the cloud sync backend.",
    usage: "gproj sync [push|pull|status]",
    example: "gproj sync status",
  },
  {
    name: "resources",
    group: "resources",
    summary: "Manage resource cards and generated OKF bundles.",
    whenToUse: "Add, organize, inspect, index, or search persistent project resources.",
    usage: "gproj resources <subcommand>",
    example: "gproj resources list",
  },
  {
    name: "catalog",
    group: "agent",
    summary: "Print the self-describing gproj command catalog.",
    whenToUse: "Discover current commands or route an agent intent to the right command.",
    usage: "gproj catalog [--json] [--intent <text>]",
    example: 'gproj catalog --intent "find project resources"',
  },
  {
    name: "install-agent",
    group: "agent",
    summary: "Install or uninstall generated agent instructions.",
    whenToUse: "Set up Claude skill and Codex AGENTS guidance globally or for a project.",
    usage: "gproj install-agent [--global|--project] [--claude] [--codex] [--uninstall]",
    example: "gproj install-agent --project --codex",
  },
  {
    name: "resources add",
    group: "resources",
    summary: "Import a local file into the resource manifest.",
    whenToUse: "Persist a document, spec, note, or asset as a discoverable resource card.",
    usage: "gproj resources add [options] <path>",
    example: "gproj resources add --category docs README.md",
  },
  {
    name: "resources organise",
    group: "resources",
    summary: "Bulk-import files from a directory.",
    whenToUse: "Turn a directory of project documents into resource cards.",
    usage: "gproj resources organise [--dry-run] [--delete] [--category <category>] [dir]",
    example: "gproj resources organise --dry-run docs",
  },
  {
    name: "resources list",
    group: "resources",
    summary: "List resource cards.",
    whenToUse: "Scan known resources, optionally by category.",
    usage: "gproj resources list [--category <category>]",
    example: "gproj resources list --category docs",
  },
  {
    name: "resources show",
    group: "resources",
    summary: "Print one resource card as JSON.",
    whenToUse: "Inspect exact metadata for a resource id.",
    usage: "gproj resources show <id>",
    example: "gproj resources show resource-id",
  },
  {
    name: "resources find",
    group: "resources",
    summary: "Find resources by symbol, intent, title, tag, or body text.",
    whenToUse: "Locate resources relevant to a code symbol, endpoint, config key, or task phrase.",
    usage: "gproj resources find [--limit <n>|--all] <query>",
    example: 'gproj resources find --limit 10 "AuthService.login"',
  },
  {
    name: "resources enrich",
    group: "resources",
    summary: "Ask the planner to add retrieval metadata to resource cards.",
    whenToUse: "Populate missing enrichment fields for imported resources before relying on resource search and links at scale; add --code-root to merge deterministic code grounding.",
    usage: "gproj resources enrich [--category <category>] [--limit <n>] [--batch-size <n>] [--code-root <path>] [--dry-run] [--reenrich] [--relink]",
    example: "gproj resources enrich --category docs --limit 30 --code-root src",
  },
  {
    name: "resources ground",
    group: "resources",
    summary: "Deterministically ground resource cards against source code.",
    whenToUse: "Populate verified owns symbols/endpoints and schemaSource refs from actual source code without invoking the planner.",
    usage: "gproj resources ground [--code-root <path>]",
    example: "gproj resources ground --code-root src",
  },
  {
    name: "resources audit",
    group: "resources",
    summary: "Report structural metrics and optional judged link precision for resource cards.",
    whenToUse: "Inspect coverage, graph connectivity, integrity issues, distributions, health score, and sampled LLM-judged link quality without mutating resources.",
    usage: "gproj resources audit [--json] [--judge] [--sample <n>]",
    example: "gproj resources audit --judge --sample 20",
  },
  {
    name: "resources eval",
    group: "resources",
    summary: "Evaluate resource retrieval against an evalset.",
    whenToUse: "Measure ranked resource search quality with precision, recall, nDCG, and optional link recall, or generate a candidate evalset.",
    usage: "gproj resources eval <evalset.json> [--json] | gproj resources eval --generate [--out <file>]",
    example: "gproj resources eval resources.eval.json",
  },
  {
    name: "resources schema",
    group: "resources",
    summary: "Resolve schemaSource pointers for a resource.",
    whenToUse: "Check whether a resource's source-code pointers still resolve.",
    usage: "gproj resources schema <id>",
    example: "gproj resources schema resource-id",
  },
  {
    name: "resources index",
    group: "resources",
    summary: "Regenerate the OKF resource index cache.",
    whenToUse: "Refresh generated resource lookup data after manifest changes.",
    usage: "gproj resources index",
    example: "gproj resources index",
  },
  {
    name: "resources link",
    group: "resources",
    summary: "Add a relation between two resource cards.",
    whenToUse: "Record that one resource references or depends on another.",
    usage: "gproj resources link <fromId> <rel> <toId>",
    example: "gproj resources link spec references adr",
  },
  {
    name: "resources rm",
    group: "resources",
    summary: "Remove a resource card and inbound links.",
    whenToUse: "Delete a stale or incorrect resource entry from the manifest.",
    usage: "gproj resources rm <id>",
    example: "gproj resources rm resource-id",
  },
  {
    name: "resources doctor",
    group: "resources",
    summary: "Check resource manifest and generated bundle health.",
    whenToUse: "Validate resource cards, links, assets, and OKF output.",
    usage: "gproj resources doctor",
    example: "gproj resources doctor",
  },
  {
    name: "resources capture",
    group: "capture",
    summary: "Capture a Claude transcript into a pending resource.",
    whenToUse: "Create a pending SOP/resource from the current or specified Claude session.",
    usage: "gproj resources capture [--auto] --session <id>",
    example: "gproj resources capture --session session-id",
  },
  {
    name: "resources capture list",
    group: "capture",
    summary: "List pending captured resources.",
    whenToUse: "Inspect captures waiting for finalize or discard.",
    usage: "gproj resources capture list",
    example: "gproj resources capture list",
  },
  {
    name: "resources capture finalize",
    group: "capture",
    summary: "Finalize a pending capture into a resource card.",
    whenToUse: "Accept a captured workflow as a new or refined resource.",
    usage: "gproj resources capture finalize <id> [--share] [--add|--refine <id>]",
    example: "gproj resources capture finalize capture-id --add",
  },
  {
    name: "resources capture discard",
    group: "capture",
    summary: "Discard a pending capture.",
    whenToUse: "Remove a captured workflow that should not become a resource.",
    usage: "gproj resources capture discard <id>",
    example: "gproj resources capture discard capture-id",
  },
  {
    name: "resources capture install-hook",
    group: "capture",
    summary: "Install or uninstall the Claude stop hook for capture.",
    whenToUse: "Enable or remove automatic transcript capture at Claude session stop.",
    usage: "gproj resources capture install-hook [--global|--project] [--uninstall]",
    example: "gproj resources capture install-hook --project",
  },
];

interface RankedCatalogEntry {
  entry: CatalogEntry;
  score: number;
  index: number;
}

function uniqueGroups(entries: CatalogEntry[]): string[] {
  const groups: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.group)) continue;
    seen.add(entry.group);
    groups.push(entry.group);
  }
  return groups;
}

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9_-]+/).filter(Boolean);
}

function fieldScore(value: string, query: string, queryTokens: string[], weight: number): number {
  const haystack = value.toLowerCase();
  let score = haystack.includes(query) ? weight * 4 : 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) score += weight;
  }
  return score;
}

function scoreEntry(entry: CatalogEntry, intent: string): number {
  const query = intent.toLowerCase().trim();
  const queryTokens = tokens(query);
  if (!query || queryTokens.length === 0) return 0;
  return fieldScore(entry.name, query, queryTokens, 16) +
    fieldScore(entry.whenToUse, query, queryTokens, 10) +
    fieldScore(entry.summary, query, queryTokens, 8) +
    fieldScore(entry.group, query, queryTokens, 4) +
    fieldScore(entry.usage, query, queryTokens, 3) +
    fieldScore(entry.example, query, queryTokens, 2);
}

export function rankCatalogEntries(intent: string, entries: CatalogEntry[] = catalogEntries): CatalogEntry[] {
  return entries
    .map((entry, index): RankedCatalogEntry => ({ entry, score: scoreEntry(entry, intent), index }))
    .filter((ranked) => ranked.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((ranked) => ranked.entry);
}

function renderEntry(entry: CatalogEntry): string {
  return [
    `- ${entry.name}`,
    `  summary: ${entry.summary}`,
    `  when: ${entry.whenToUse}`,
    `  usage: ${entry.usage}`,
    `  example: ${entry.example}`,
  ].join("\n");
}

export function renderCatalogText(entries: CatalogEntry[] = catalogEntries, note?: string): string {
  const lines: string[] = [];
  if (note) lines.push(note, "");
  lines.push("gproj catalog");
  for (const group of uniqueGroups(entries)) {
    lines.push("", `${group}:`);
    for (const entry of entries.filter((candidate) => candidate.group === group)) {
      lines.push(renderEntry(entry));
    }
  }
  return lines.join("\n");
}

export function renderCatalogJson(entries: CatalogEntry[] = catalogEntries): string {
  return `${JSON.stringify(entries, null, 2)}\n`;
}
