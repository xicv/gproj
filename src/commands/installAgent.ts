import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { generateCodexAgentsBlock, managedBegin, managedEnd } from "../agent/agents.js";
import { generateClaudeSkillMarkdown } from "../agent/skill.js";
import { atomicWrite } from "../format/store.js";

export interface InstallAgentDeps {
  env?: NodeJS.ProcessEnv;
  home?: string;
}

interface MarkerState {
  hasMarkers: boolean;
  begin: number;
  end: number;
}

function usage(): string {
  return "usage: gproj install-agent [--global|--project] [--claude] [--codex] [--uninstall]";
}

function countMarker(content: string, marker: string): number {
  return content.split(marker).length - 1;
}

function markerState(content: string, path: string): MarkerState {
  const beginCount = countMarker(content, managedBegin);
  const endCount = countMarker(content, managedEnd);
  if (beginCount !== endCount || beginCount > 1 || endCount > 1) {
    throw new Error(`corrupt gproj managed block in ${path}`);
  }
  if (beginCount === 0) return { hasMarkers: false, begin: -1, end: -1 };
  const begin = content.indexOf(managedBegin);
  const end = content.indexOf(managedEnd);
  if (begin < 0 || end < begin) throw new Error(`corrupt gproj managed block in ${path}`);
  return { hasMarkers: true, begin, end: end + managedEnd.length };
}

function managedBlock(content: string): string {
  const state = markerState(content, "generated content");
  if (!state.hasMarkers) throw new Error("generated gproj content is missing managed markers");
  return content.slice(state.begin, state.end);
}

function replaceManagedBlock(existing: string, nextBlock: string, path: string): string {
  const state = markerState(existing, path);
  if (!state.hasMarkers) return existing;
  return `${existing.slice(0, state.begin)}${nextBlock}${existing.slice(state.end)}`;
}

function removeManagedBlock(existing: string, path: string): string {
  const state = markerState(existing, path);
  if (!state.hasMarkers) return existing;
  const next = `${existing.slice(0, state.begin)}${existing.slice(state.end)}`;
  return next.replace(/\n{3,}/g, "\n\n").trim() ? `${next.trim()}\n` : "";
}

function isLegacyClaudeSkill(content: string): boolean {
  return content.includes("name: gproj") &&
    content.includes("persistent planner brain") &&
    content.includes("gproj init") &&
    !content.includes(managedBegin);
}

function isGeneratedClaudeSkill(content: string): boolean {
  const generated = generateClaudeSkillMarkdown();
  const state = markerState(content, "Claude SKILL.md");
  if (!state.hasMarkers) return content.trim() === generated.trim();
  const outside = `${content.slice(0, state.begin)}${content.slice(state.end)}`.trim();
  const generatedPrefix = generated.slice(0, generated.indexOf(managedBegin)).trim();
  return outside === generatedPrefix;
}

function legacyCodexPattern(): RegExp {
  return /# gproj \(Codex\)\n\nThis repo uses gproj for planner-brain state\.[\s\S]*?current phase's exec prompt in `\.gproj\/packages\/`\./;
}

function isLegacyCodexAgents(content: string): boolean {
  return legacyCodexPattern().test(content) && !content.includes(managedBegin);
}

function installClaudeSkill(path: string): string {
  const generated = generateClaudeSkillMarkdown();
  if (!existsSync(path)) {
    atomicWrite(path, generated);
    return `claude installed: ${path}`;
  }

  const existing = readFileSync(path, "utf8");
  if (isLegacyClaudeSkill(existing)) {
    atomicWrite(path, generated);
    return `claude installed: ${path}`;
  }

  const block = managedBlock(generated);
  const state = markerState(existing, path);
  const next = state.hasMarkers ? replaceManagedBlock(existing, block, path) : `${generated.trimEnd()}\n\n${existing}`;
  atomicWrite(path, next.endsWith("\n") ? next : `${next}\n`);
  return `claude installed: ${path}`;
}

function uninstallClaudeSkill(skillDir: string, path: string): string {
  if (!existsSync(path)) return `claude already absent: ${path}`;
  const existing = readFileSync(path, "utf8");
  if (isLegacyClaudeSkill(existing) || isGeneratedClaudeSkill(existing)) {
    rmSync(skillDir, { recursive: true, force: true });
    return `claude uninstalled: ${path}`;
  }
  const next = removeManagedBlock(existing, path);
  if (!next) {
    rmSync(skillDir, { recursive: true, force: true });
  } else {
    atomicWrite(path, next);
  }
  return `claude uninstalled: ${path}`;
}

function installCodexAgents(path: string): string {
  const block = generateCodexAgentsBlock();
  if (!existsSync(path)) {
    atomicWrite(path, block);
    return `codex installed: ${path}`;
  }

  const existing = readFileSync(path, "utf8");
  if (isLegacyCodexAgents(existing)) {
    const next = existing.replace(legacyCodexPattern(), block.trimEnd());
    atomicWrite(path, next.endsWith("\n") ? next : `${next}\n`);
    return `codex installed: ${path}`;
  }

  const state = markerState(existing, path);
  const next = state.hasMarkers ? replaceManagedBlock(existing, block.trimEnd(), path) : `${existing.trimEnd()}\n\n${block}`;
  atomicWrite(path, next.endsWith("\n") ? next : `${next}\n`);
  return `codex installed: ${path}`;
}

function uninstallCodexAgents(path: string): string {
  if (!existsSync(path)) return `codex already absent: ${path}`;
  const existing = readFileSync(path, "utf8");
  let next: string;
  if (isLegacyCodexAgents(existing)) {
    next = existing.replace(legacyCodexPattern(), "").replace(/\n{3,}/g, "\n\n").trim();
  } else {
    next = removeManagedBlock(existing, path).trim();
  }

  if (!next) {
    unlinkSync(path);
  } else {
    atomicWrite(path, `${next}\n`);
  }
  return `codex uninstalled: ${path}`;
}

function homeFromDeps(deps: InstallAgentDeps): string {
  return deps.home ?? deps.env?.HOME ?? homedir();
}

export function runInstallAgent(root: string, args: string[], deps: InstallAgentDeps = {}): string {
  const parsed = parseArgs({
    args,
    allowPositionals: false,
    options: {
      global: { type: "boolean", default: false },
      project: { type: "boolean", default: false },
      claude: { type: "boolean", default: false },
      codex: { type: "boolean", default: false },
      uninstall: { type: "boolean", default: false },
    },
  });

  const globalScope = parsed.values.global === true;
  const projectScope = parsed.values.project === true;
  if (globalScope && projectScope) throw new Error(usage());
  const scope = projectScope ? "project" : "global";

  const claude = parsed.values.claude === true;
  const codex = parsed.values.codex === true;
  const installClaude = claude || !codex;
  const installCodex = codex || !claude;
  const uninstall = parsed.values.uninstall === true;

  const home = homeFromDeps(deps);
  const claudeSkillDir = scope === "global"
    ? join(home, ".claude", "skills", "gproj")
    : join(root, ".claude", "skills", "gproj");
  const claudeSkillPath = join(claudeSkillDir, "SKILL.md");
  const codexAgentsPath = scope === "global"
    ? join(home, ".codex", "AGENTS.md")
    : join(root, "AGENTS.md");

  const lines: string[] = [`gproj install-agent ${uninstall ? "uninstall" : "install"} (${scope})`];
  if (installClaude) {
    if (!uninstall) mkdirSync(dirname(claudeSkillPath), { recursive: true });
    lines.push(uninstall ? uninstallClaudeSkill(claudeSkillDir, claudeSkillPath) : installClaudeSkill(claudeSkillPath));
  }
  if (installCodex) {
    if (!uninstall) mkdirSync(dirname(codexAgentsPath), { recursive: true });
    lines.push(uninstall ? uninstallCodexAgents(codexAgentsPath) : installCodexAgents(codexAgentsPath));
  }
  return lines.join("\n");
}
