import { describe, it, expect } from "vitest";
import { captureHead, gitEvidence, type RunFn } from "../../src/verifier/git.js";

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
