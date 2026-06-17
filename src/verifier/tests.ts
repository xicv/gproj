import { spawnSync } from "node:child_process";
import type { RunFn } from "./git.js";

const tail = (value: string) => value.slice(-2000);

const defaultRun: RunFn = (command, cwd) => {
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    encoding: "utf8",
    timeout: 600_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || result.status === null) {
    return {
      stdout: "",
      stderr: String(result.error ?? "killed"),
      code: result.status ?? null,
    };
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status,
  };
};

export interface CheckResult {
  command: string[];
  exitCode: number | null;
  passed: boolean;
  stdoutTail: string;
  stderrTail: string;
}

export interface VerifierResult {
  verifierStatus: "verified" | "failed" | "unverified";
  verifierPassed: boolean;
  checks: CheckResult[];
  verifierFailures: string[];
}

export const UNVERIFIED_RUN_BANNER = "UNVERIFIED RUN (no test/typecheck configured)";

export function runChecks(
  root: string,
  cfg: { testCommand?: string[]; typecheckCommand?: string[]; configExists?: boolean },
  run: RunFn = defaultRun,
): VerifierResult {
  const missing: string[] = [];
  if (cfg.configExists === false) missing.push(".gproj/config.json missing");
  if (!cfg.typecheckCommand) missing.push("typecheckCommand missing");
  if (!cfg.testCommand) missing.push("testCommand missing");

  const commands = [cfg.typecheckCommand, cfg.testCommand].filter((command): command is string[] => command !== undefined);
  const checks = commands.map((command) => {
    const result = run(command, root);
    return {
      command,
      exitCode: result.code,
      passed: result.code === 0,
      stdoutTail: tail(result.stdout),
      stderrTail: tail(result.stderr),
    };
  });
  const commandFailures = checks
    .filter((check) => !check.passed)
    .map((check) => `${check.command.join(" ")} exited ${check.exitCode}`);

  if (missing.length > 0) {
    const reasonParts: string[] = [];
    if (cfg.configExists === false) reasonParts.push(".gproj/config.json missing");
    if (!cfg.typecheckCommand && !cfg.testCommand) {
      reasonParts.push("no testCommand/typecheckCommand configured");
    } else {
      if (!cfg.typecheckCommand) reasonParts.push("typecheckCommand missing");
      if (!cfg.testCommand) reasonParts.push("testCommand missing");
    }
    return {
      verifierStatus: "unverified",
      verifierPassed: false,
      checks,
      verifierFailures: [`unverified: ${reasonParts.join("; ")}`, ...commandFailures],
    };
  }

  return {
    verifierStatus: checks.every((check) => check.passed) ? "verified" : "failed",
    verifierPassed: checks.every((check) => check.passed),
    checks,
    verifierFailures: commandFailures,
  };
}
