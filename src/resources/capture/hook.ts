import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { atomicWrite } from "../../format/store.js";

const hookCommand = 'gproj resources capture --auto --session "$CLAUDE_SESSION_ID"';

interface ClaudeHookCommand {
  type: "command";
  command: string;
}

interface ClaudeHookMatcher {
  matcher?: string;
  hooks?: ClaudeHookCommand[];
}

interface ClaudeSettings {
  hooks?: Record<string, ClaudeHookMatcher[]>;
  [key: string]: unknown;
}

export interface HookInstallOptions {
  home?: string;
  uninstall?: boolean;
}

function settingsPath(home: string): string {
  return join(home, ".claude", "settings.json");
}

function readSettings(path: string): ClaudeSettings {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as ClaudeSettings;
}

function hookSnippet(): ClaudeHookMatcher {
  return {
    matcher: "",
    hooks: [{ type: "command", command: hookCommand }],
  };
}

function containsHook(entry: ClaudeHookMatcher): boolean {
  return (entry.hooks ?? []).some((hook) => hook.type === "command" && hook.command === hookCommand);
}

function withoutHook(entries: ClaudeHookMatcher[]): ClaudeHookMatcher[] {
  return entries
    .map((entry) => ({
      ...entry,
      hooks: (entry.hooks ?? []).filter((hook) => hook.command !== hookCommand),
    }))
    .filter((entry) => (entry.hooks ?? []).length > 0);
}

export function installStopHook(options: HookInstallOptions = {}): string {
  const home = options.home ?? homedir();
  const path = settingsPath(home);
  mkdirSync(dirname(path), { recursive: true });
  const settings = readSettings(path);
  const hooks = settings.hooks ?? {};
  const stop = hooks.Stop ?? [];

  if (options.uninstall === true) {
    const next: ClaudeSettings = {
      ...settings,
      hooks: {
        ...hooks,
        Stop: withoutHook(stop),
      },
    };
    atomicWrite(path, `${JSON.stringify(next, null, 2)}\n`);
    return `capture stop hook uninstalled\ncommand: ${hookCommand}\n${JSON.stringify(hookSnippet(), null, 2)}`;
  }

  const nextStop = stop.some(containsHook) ? stop : [...stop, hookSnippet()];
  const next: ClaudeSettings = {
    ...settings,
    hooks: {
      ...hooks,
      Stop: nextStop,
    },
  };
  atomicWrite(path, `${JSON.stringify(next, null, 2)}\n`);
  return `capture stop hook installed\ncommand: ${hookCommand}\n${JSON.stringify(hookSnippet(), null, 2)}`;
}

export { hookCommand };
