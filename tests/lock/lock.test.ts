import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withLock } from "../../src/lock/lock.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "gproj-")); });

const lockPath = () => join(root, ".gproj", ".lock");
const holder = (pid: number, label = "other", token = "foreign-token") =>
  JSON.stringify({ pid, label, ts: 1, token });

describe("withLock", () => {
  it("runs fn and releases the lock", async () => {
    await expect(withLock(root, "test", () => "ok")).resolves.toBe("ok");
    expect(existsSync(lockPath())).toBe(false);
  });

  it("throws when a fresh live lock is held", async () => {
    await withLock(root, "setup", () => undefined);
    writeFileSync(lockPath(), holder(process.pid));

    await expect(withLock(root, "test", () => undefined)).rejects.toThrow(/busy/);
  });

  it("steals a stale lock based on mtime", async () => {
    await withLock(root, "setup", () => undefined);
    writeFileSync(lockPath(), holder(process.pid, "old"));
    const past = new Date(Date.now() - 10_000);
    utimesSync(lockPath(), past, past);

    await expect(withLock(root, "test", () => "ok", { staleMs: 1 })).resolves.toBe("ok");
    expect(existsSync(lockPath())).toBe(false);
  });

  it("steals a lock whose pid is dead", async () => {
    await withLock(root, "setup", () => undefined);
    writeFileSync(lockPath(), holder(2_147_483_646, "dead"));

    await expect(withLock(root, "test", () => "ok")).resolves.toBe("ok");
    expect(existsSync(lockPath())).toBe(false);
  });

  it("does not delete a successor lock on release", async () => {
    await expect(withLock(root, "test", () => {
      writeFileSync(lockPath(), holder(process.pid, "successor", "successor-token"));
      return "ok";
    })).resolves.toBe("ok");

    expect(existsSync(lockPath())).toBe(true);
    expect(JSON.parse(readFileSync(lockPath(), "utf8")).token).toBe("successor-token");
  });

  it("does not steal an unreadable recent lock", async () => {
    await withLock(root, "setup", () => undefined);
    writeFileSync(lockPath(), "garbage");

    await expect(withLock(root, "test", () => undefined)).rejects.toThrow(/busy/);
  });
});
