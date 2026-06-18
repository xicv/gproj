import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../src/cli.js";
import { managedBegin, managedEnd } from "../../src/agent/agents.js";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function install(root: string, home: string, args: string[]): Promise<string> {
  const lines: string[] = [];
  await runCli(root, ["install-agent", ...args], {
    log: (line) => lines.push(line),
    error: (line) => lines.push(line),
  }, { HOME: home });
  return lines.join("\n");
}

function markerCount(content: string): number {
  return content.split(managedBegin).length - 1 + content.split(managedEnd).length - 1;
}

describe("install-agent", () => {
  it("installs project Claude and Codex files idempotently without touching global paths", async () => {
    const root = tempDir("gproj-");
    const home = tempDir("gproj-home-");

    await Promise.all([
      install(root, home, ["--project"]),
      install(root, home, ["--project"]),
    ]);

    const skillPath = join(root, ".claude", "skills", "gproj", "SKILL.md");
    const agentsPath = join(root, "AGENTS.md");
    const firstSkill = readFileSync(skillPath, "utf8");
    const firstAgents = readFileSync(agentsPath, "utf8");

    await install(root, home, ["--project"]);

    expect(readFileSync(skillPath, "utf8")).toBe(firstSkill);
    expect(readFileSync(agentsPath, "utf8")).toBe(firstAgents);
    expect(firstSkill).toContain("gproj catalog");
    expect(firstAgents).toContain("gproj <cmd> --help");
    expect(markerCount(firstSkill)).toBe(2);
    expect(markerCount(firstAgents)).toBe(2);
    expect(existsSync(join(home, ".claude", "skills", "gproj", "SKILL.md"))).toBe(false);
    expect(existsSync(join(home, ".codex", "AGENTS.md"))).toBe(false);
    expect(readdirSync(join(root, ".claude", "skills", "gproj")).some((name) => name.includes(".tmp-"))).toBe(false);
  });

  it("installs global files and keeps project scope isolated", async () => {
    const root = tempDir("gproj-");
    const home = tempDir("gproj-home-");

    await install(root, home, ["--global", "--codex"]);
    await install(root, home, ["--project", "--codex"]);
    await install(root, home, ["--project", "--codex", "--uninstall"]);

    expect(existsSync(join(home, ".codex", "AGENTS.md"))).toBe(true);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
  });

  it("preserves surrounding AGENTS content on install and uninstall", async () => {
    const root = tempDir("gproj-");
    const home = tempDir("gproj-home-");
    const agentsPath = join(root, "AGENTS.md");
    writeFileSync(agentsPath, "before\n\nafter\n");

    await install(root, home, ["--project", "--codex"]);
    const installed = readFileSync(agentsPath, "utf8");
    expect(installed).toContain("before");
    expect(installed).toContain("after");
    expect(installed).toContain(managedBegin);

    await install(root, home, ["--project", "--codex", "--uninstall"]);
    expect(readFileSync(agentsPath, "utf8")).toBe("before\n\nafter\n");
  });

  it("upgrades legacy Claude skill and Codex AGENTS text without duplicating static command lists", async () => {
    const root = tempDir("gproj-");
    const home = tempDir("gproj-home-");
    const skillPath = join(root, ".claude", "skills", "gproj", "SKILL.md");
    const agentsPath = join(root, "AGENTS.md");
    mkdirSync(join(root, ".claude", "skills", "gproj"), { recursive: true });
    writeFileSync(skillPath, [
      "---",
      "name: gproj",
      "description: persistent planner brain",
      "---",
      "",
      '- New project: `gproj init "<goal>"`',
      "- One round: `gproj advance`",
      "",
    ].join("\n"), { flag: "w" });
    writeFileSync(agentsPath, [
      "# gproj (Codex)",
      "",
      "This repo uses gproj for planner-brain state. Drive it with the CLI:",
      '`gproj init "<goal>"` · `gproj advance` · `gproj status` · `gproj decide accept|adjust|reject`.',
      "Set `GPROJ_EXECUTOR=codex`. Do not expand scope beyond the current phase's exec prompt in `.gproj/packages/`.",
      "",
    ].join("\n"), { flag: "w" });

    await install(root, home, ["--project"]);
    const skill = readFileSync(skillPath, "utf8");
    const agents = readFileSync(agentsPath, "utf8");

    expect(skill).toContain(managedBegin);
    expect(agents).toContain(managedBegin);
    expect(skill).not.toContain("gproj init");
    expect(agents).not.toContain("gproj advance");
    expect(markerCount(skill)).toBe(2);
    expect(markerCount(agents)).toBe(2);
  });

  it("uninstalls generated project files without leaving partial state", async () => {
    const root = tempDir("gproj-");
    const home = tempDir("gproj-home-");
    const skillDir = join(root, ".claude", "skills", "gproj");

    await install(root, home, ["--project"]);
    await install(root, home, ["--project", "--uninstall"]);

    expect(existsSync(skillDir)).toBe(false);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
  });

  it("rejects corrupt managed blocks without modifying the file", async () => {
    const root = tempDir("gproj-");
    const home = tempDir("gproj-home-");
    const agentsPath = join(root, "AGENTS.md");
    const original = `user content\n${managedBegin}\n`;
    writeFileSync(agentsPath, original);

    await expect(install(root, home, ["--project", "--codex"])).rejects.toThrow("corrupt gproj managed block");
    expect(readFileSync(agentsPath, "utf8")).toBe(original);
  });
});
