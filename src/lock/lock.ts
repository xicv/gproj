import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isLockStale, isPidDead, lockPath, readHolder, type LockHolder } from "./inspect.js";

const defaultStaleMs = 120_000;
let counter = 0;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function createHolder(label: string): LockHolder {
  const nonce = process.hrtime.bigint().toString(36);
  return {
    pid: process.pid,
    label,
    ts: Number(process.hrtime.bigint() / 1_000_000n),
    token: `${process.pid}-${counter++}-${nonce}`,
  };
}

function busyError(holder: LockHolder | null): Error {
  if (!holder) return new Error("gproj is busy: lock is held by another process");
  return new Error(`gproj is busy: ${holder.label} held by pid ${holder.pid}`);
}

function tryCreate(path: string, holder: LockHolder): boolean {
  try {
    writeFileSync(path, JSON.stringify(holder), { flag: "wx" });
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") return false;
    throw error;
  }
}

function acquire(root: string, path: string, holder: LockHolder, staleMs: number): void {
  if (tryCreate(path, holder)) return;

  const current = readHolder(root);
  let isStale: boolean;
  try {
    isStale = isLockStale(root, staleMs);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      if (tryCreate(path, holder)) return;
      throw busyError(readHolder(root));
    }
    throw error;
  }

  const isDead = current ? isPidDead(current.pid) : false;

  if (!isStale && !isDead) throw busyError(current);

  try {
    unlinkSync(path);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }

  if (!tryCreate(path, holder)) throw busyError(readHolder(root));
}

export async function withLock<T>(
  root: string,
  label: string,
  fn: () => Promise<T> | T,
  opts: { staleMs?: number } = {},
): Promise<T> {
  const dir = join(root, ".gproj");
  const path = lockPath(root);
  const holder = createHolder(label);
  mkdirSync(dir, { recursive: true });

  acquire(root, path, holder, opts.staleMs ?? defaultStaleMs);

  try {
    return await fn();
  } finally {
    try {
      if (readHolder(root)?.token === holder.token) unlinkSync(path);
    } catch {
      // Release is best effort and must not mask errors from fn().
    }
  }
}
