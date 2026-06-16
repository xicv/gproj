import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function ensureDistCli(): string {
  const cli = resolve("dist/cli.js");
  if (!existsSync(cli)) {
    execFileSync("npx", ["tsc", "-p", "tsconfig.json"], { stdio: "pipe", timeout: 120_000 });
  }
  return cli;
}

describe("bin entry", () => {
  it("runs main when invoked through an npm-style symlink", () => {
    const cli = ensureDistCli();
    const binDir = mkdtempSync(join(tmpdir(), "gproj-bin-"));
    const root = mkdtempSync(join(tmpdir(), "gproj-cwd-"));
    const link = join(binDir, "gproj-link");
    symlinkSync(cli, link);

    try {
      execFileSync(process.execPath, [link, "bogus"], { cwd: root, encoding: "utf8", stdio: "pipe" });
      throw new Error("expected symlinked CLI invocation to fail");
    } catch (e) {
      const err = e as { status?: number; stderr?: string };
      expect(err.status).toBe(2);
      expect(err.stderr).toContain("unknown command");
    }
  });
});
