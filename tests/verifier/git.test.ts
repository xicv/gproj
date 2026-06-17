import { describe, it, expect } from "vitest";
import { captureHead, captureStagedEvidence, gitEvidence, stageForEvidence, type RunFn } from "../../src/verifier/git.js";

describe("git verifier", () => {
  it("captures the trimmed head sha", () => {
    const run: RunFn = () => ({ stdout: "abc123\n", stderr: "", code: 0 });
    expect(captureHead("/repo", run)).toBe("abc123");
  });

  it("parses porcelain into changed files and marks the repo dirty", () => {
    const run: RunFn = (command) => {
      const joined = command.join(" ");
      if (joined === "git rev-parse HEAD") return { stdout: "post\n", stderr: "", code: 0 };
      if (joined === "git status --porcelain=v1") {
        return { stdout: " M src/a.ts\nA  src/b.ts\n?? docs/new.md\nR  old.ts -> new.ts\n", stderr: "", code: 0 };
      }
      if (joined === "git diff --stat") return { stdout: " src/a.ts | 2 +-\n", stderr: "", code: 0 };
      return { stdout: "", stderr: "unexpected", code: 1 };
    };

    expect(gitEvidence("/repo", "base", run)).toEqual({
      baseHead: "base",
      postHead: "post",
      isRepo: true,
      dirtyAfter: true,
      changedFiles: [
        { status: "M", path: "src/a.ts" },
        { status: "A", path: "src/b.ts" },
        { status: "??", path: "docs/new.md" },
        { status: "R", path: "old.ts -> new.ts" },
      ],
      diffStat: "src/a.ts | 2 +-",
    });
  });

  it("captureStagedEvidence stages new files so diffStat and diff include them", () => {
    const calls: string[] = [];
    const run: RunFn = (command) => {
      const joined = command.join(" ");
      calls.push(joined);
      if (joined.startsWith("git add -A")) return { stdout: "", stderr: "", code: 0 };
      if (joined.includes("diff --cached --stat HEAD")) {
        return { stdout: " src/old.ts | 2 +-\n src/new.ts | 9 +++++++++\n 2 files changed\n", stderr: "", code: 1 };
      }
      if (joined.includes("diff --cached HEAD")) {
        return { stdout: "diff --git a/src/new.ts b/src/new.ts\nnew file mode 100644\n+const x = 1;\n", stderr: "", code: 1 };
      }
      return { stdout: "", stderr: "unexpected", code: 1 };
    };

    const result = captureStagedEvidence("/wt", run);
    expect(result).not.toBeNull();
    expect(result?.diffStat).toContain("src/new.ts");
    expect(result?.diff).toContain("new file mode");
    expect(calls.some((c) => c.startsWith("git add -A"))).toBe(true);
  });

  it("allows exec-style explicit staging before evidence capture", () => {
    const calls: string[] = [];
    const run: RunFn = (command) => {
      const joined = command.join(" ");
      calls.push(joined);
      if (joined.startsWith("git add -A")) return { stdout: "", stderr: "", code: 0 };
      if (joined === "git rev-parse HEAD") return { stdout: "post\n", stderr: "", code: 0 };
      if (joined === "git status --porcelain=v1") return { stdout: "A  src/new.ts\n", stderr: "", code: 0 };
      if (joined === "git diff --stat") return { stdout: "", stderr: "", code: 0 };
      if (joined.includes("diff --cached --stat HEAD")) return { stdout: " src/new.ts | 1 +\n", stderr: "", code: 0 };
      if (joined.includes("diff --cached HEAD")) return { stdout: "diff --git a/src/new.ts b/src/new.ts\nnew file mode 100644\n", stderr: "", code: 0 };
      return { stdout: "", stderr: "unexpected", code: 1 };
    };

    expect(stageForEvidence("/wt", run)).toEqual({ staged: true });
    expect(gitEvidence("/wt", "base", run).changedFiles).toEqual([{ status: "A", path: "src/new.ts" }]);
    expect(captureStagedEvidence("/wt", run, { alreadyStaged: true })?.diffStat).toContain("src/new.ts");
    expect(calls[0]).toContain("git add -A");
    expect(calls.filter((call) => call.startsWith("git add -A")).length).toBe(1);
  });

  it("stages with a bare `git add -A` (no pathspec) so symlinked node_modules cannot break it", () => {
    let addArgs: string[] | null = null;
    const run: RunFn = (command) => {
      if (command[0] === "git" && command[1] === "add") addArgs = command;
      return { stdout: "", stderr: "", code: 0 };
    };

    expect(stageForEvidence("/wt", run)).toEqual({ staged: true });
    expect(addArgs).toEqual(["git", "add", "-A"]);
    // Never pass a pathspec to `git add`: ':(exclude)node_modules/**' is "beyond a
    // symbolic link" when node_modules is symlinked into the worktree.
    expect(addArgs).not.toContain("--");
    expect((addArgs as unknown as string[]).some((a) => a.includes(":(exclude)"))).toBe(false);
  });

  it("captureStagedEvidence bounds an oversized diff", () => {
    const big = "+".repeat(20_000);
    const run: RunFn = (command) => {
      const joined = command.join(" ");
      if (joined.startsWith("git add -A")) return { stdout: "", stderr: "", code: 0 };
      if (joined.includes("--stat")) return { stdout: "stat", stderr: "", code: 1 };
      return { stdout: big, stderr: "", code: 1 };
    };

    const result = captureStagedEvidence("/wt", run);
    expect(result?.diff.length).toBeLessThan(big.length);
    expect(result?.diff).toContain("[diff truncated");
  });

  it("captureStagedEvidence returns null when staging fails", () => {
    const run: RunFn = () => ({ stdout: "", stderr: "fatal", code: 128 });
    expect(captureStagedEvidence("/wt", run)).toBeNull();
  });

  it("returns non-repo evidence when rev-parse exits nonzero", () => {
    const run: RunFn = () => ({ stdout: "", stderr: "fatal", code: 128 });

    expect(gitEvidence("/repo", "base", run)).toEqual({
      baseHead: "base",
      postHead: null,
      isRepo: false,
      dirtyAfter: false,
      changedFiles: [],
      diffStat: "",
    });
  });
});
