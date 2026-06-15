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
  verifierPassed: boolean;
  checks: CheckResult[];
  verifierFailures: string[];
}

export function runChecks(
  root: string,
  cfg: { testCommand?: string[]; typecheckCommand?: string[] },
  run: RunFn = defaultRun,
): VerifierResult {
  const commands = [cfg.typecheckCommand, cfg.testCommand].filter((command): command is string[] => command !== undefined);
  if (commands.length === 0) {
    return {
      verifierPassed: false,
      checks: [],
      verifierFailures: ["unverified: no testCommand/typecheckCommand configured"],
    };
  }

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

  return {
    verifierPassed: checks.length > 0 && checks.every((check) => check.passed),
    checks,
    verifierFailures: checks
      .filter((check) => !check.passed)
      .map((check) => `${check.command.join(" ")} exited ${check.exitCode}`),
  };
}
