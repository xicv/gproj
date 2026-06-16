import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyWorktree, createWorktree, removeWorktree, type GitRun } from "../../src/sandbox/worktree.js";

function git(args: string[], cwd: string) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.status };
}

function initRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "gproj-wt-"));
  expect(git(["init"], root).code).toBe(0);
  expect(git(["config", "user.email", "test@example.com"], root).code).toBe(0);
  expect(git(["config", "user.name", "Test User"], root).code).toBe(0);
  writeFileSync(join(root, "README.md"), "base\n");
  expect(git(["add", "README.md"], root).code).toBe(0);
  expect(git(["commit", "-m", "init"], root).code).toBe(0);
  return root;
}

describe("worktree sandbox", () => {
  it("creates, applies, and removes a real git worktree", () => {
    const root = initRepo();
    const worktree = createWorktree(root);

    expect(existsSync(worktree.path)).toBe(true);
    expect(git(["rev-parse", "--is-inside-work-tree"], worktree.path).stdout.trim()).toBe("true");

    writeFileSync(join(worktree.path, "generated.txt"), "sandboxed\n");
    const result = applyWorktree(root, worktree.path);

    expect(result).toEqual({ applied: true, conflict: false, detail: "applied" });
    expect(readFileSync(join(root, "generated.txt"), "utf8")).toBe("sandboxed\n");

    removeWorktree(root, worktree.path);
    expect(existsSync(worktree.path)).toBe(false);
  });

  it("returns no changes when the worktree diff is empty", () => {
    const root = initRepo();
    const worktree = createWorktree(root);

    expect(applyWorktree(root, worktree.path)).toEqual({ applied: false, conflict: false, detail: "no changes" });

    removeWorktree(root, worktree.path);
  });

  it("returns conflict and leaves root untouched when the root changed concurrently", () => {
    const root = initRepo();
    const worktree = createWorktree(root);

    writeFileSync(join(worktree.path, "README.md"), "sandbox\n");
    writeFileSync(join(root, "README.md"), "root\n");

    const result = applyWorktree(root, worktree.path);

    expect(result.applied).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.detail).not.toBe("");
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("root\n");
    expect(readFileSync(join(root, "README.md"), "utf8")).not.toContain("<<<<<<<");

    removeWorktree(root, worktree.path);
  });

  it("throws a clear error when the root is not a git repo", () => {
    const root = mkdtempSync(join(tmpdir(), "gproj-nonrepo-"));
    const run: GitRun = (args) => {
      if (args.join(" ") === "rev-parse --is-inside-work-tree") {
        return { stdout: "", stderr: "fatal: not a git repository", code: 128 };
      }
      return { stdout: "", stderr: "unexpected", code: 1 };
    };

    expect(() => createWorktree(root, run)).toThrow(/not a git repository/);
  });
});
