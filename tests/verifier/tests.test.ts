import { describe, it, expect } from "vitest";
import { runChecks } from "../../src/verifier/tests.js";
import type { RunFn } from "../../src/verifier/git.js";

describe("test verifier", () => {
  it("fails closed when no commands are configured", () => {
    expect(runChecks("/repo", {})).toEqual({
      verifierStatus: "unverified",
      verifierPassed: false,
      checks: [],
      verifierFailures: ["unverified: no testCommand/typecheckCommand configured"],
    });
  });

  it("marks a partial verifier config as unverified even if configured checks pass", () => {
    const run: RunFn = () => ({ stdout: "ok", stderr: "", code: 0 });

    expect(runChecks("/repo", { testCommand: ["npm", "test"], configExists: true }, run)).toEqual({
      verifierStatus: "unverified",
      verifierPassed: false,
      checks: [
        { command: ["npm", "test"], exitCode: 0, passed: true, stdoutTail: "ok", stderrTail: "" },
      ],
      verifierFailures: ["unverified: typecheckCommand missing"],
    });
  });

  it("marks missing config as unverified", () => {
    expect(runChecks("/repo", { configExists: false })).toEqual({
      verifierStatus: "unverified",
      verifierPassed: false,
      checks: [],
      verifierFailures: ["unverified: .gproj/config.json missing; no testCommand/typecheckCommand configured"],
    });
  });

  it("runs typecheck before test and reports failing commands", () => {
    const seen: string[][] = [];
    const run: RunFn = (command) => {
      seen.push(command);
      if (command[0] === "npm" && command[1] === "run" && command[2] === "typecheck") {
        return { stdout: "ok", stderr: "", code: 0 };
      }
      return { stdout: "test output", stderr: "test failed", code: 1 };
    };

    expect(runChecks("/repo", {
      typecheckCommand: ["npm", "run", "typecheck"],
      testCommand: ["npm", "test"],
    }, run)).toEqual({
      verifierStatus: "failed",
      verifierPassed: false,
      checks: [
        { command: ["npm", "run", "typecheck"], exitCode: 0, passed: true, stdoutTail: "ok", stderrTail: "" },
        { command: ["npm", "test"], exitCode: 1, passed: false, stdoutTail: "test output", stderrTail: "test failed" },
      ],
      verifierFailures: ["npm test exited 1"],
    });
    expect(seen).toEqual([["npm", "run", "typecheck"], ["npm", "test"]]);
  });

  it("passes when all configured checks pass", () => {
    const run: RunFn = (command) => ({ stdout: `${command.join(" ")} passed`, stderr: "", code: 0 });

    expect(runChecks("/repo", {
      typecheckCommand: ["npx", "tsc", "--noEmit"],
      testCommand: ["npx", "vitest", "run"],
    }, run)).toEqual({
      verifierStatus: "verified",
      verifierPassed: true,
      checks: [
        {
          command: ["npx", "tsc", "--noEmit"],
          exitCode: 0,
          passed: true,
          stdoutTail: "npx tsc --noEmit passed",
          stderrTail: "",
        },
        {
          command: ["npx", "vitest", "run"],
          exitCode: 0,
          passed: true,
          stdoutTail: "npx vitest run passed",
          stderrTail: "",
        },
      ],
      verifierFailures: [],
    });
  });

  it("treats a null exit code as a failed check", () => {
    const run: RunFn = () => ({ stdout: "", stderr: "timed out", code: null });

    expect(runChecks("/repo", {
      typecheckCommand: ["node", "-e", ""],
      testCommand: ["npm", "test"],
    }, run)).toEqual({
      verifierStatus: "failed",
      verifierPassed: false,
      checks: [
        {
          command: ["node", "-e", ""],
          exitCode: null,
          passed: false,
          stdoutTail: "",
          stderrTail: "timed out",
        },
        {
          command: ["npm", "test"],
          exitCode: null,
          passed: false,
          stdoutTail: "",
          stderrTail: "timed out",
        },
      ],
      verifierFailures: ["node -e  exited null", "npm test exited null"],
    });
  });
});
