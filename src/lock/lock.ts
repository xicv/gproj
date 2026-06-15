import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface LockHolder {
  pid: number;
  label: string;
  ts: number;
  token: string;
}

const defaultStaleMs = 120_000;
let counter = 0;

const lockPath = (root: string) => join(root, ".gproj", ".lock");

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isPidDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return isNodeError(error) && error.code === "ESRCH";
  }
}

function readHolder(path: string): LockHolder | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LockHolder>;
    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.label !== "string" ||
      typeof parsed.ts !== "number" ||
      typeof parsed.token !== "string"
    ) return null;
    return { pid: parsed.pid, label: parsed.label, ts: parsed.ts, token: parsed.token };
  } catch {
    return null;
  }
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

function acquire(path: string, holder: LockHolder, staleMs: number): void {
  if (tryCreate(path, holder)) return;

  const current = readHolder(path);
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      if (tryCreate(path, holder)) return;
      throw busyError(readHolder(path));
    }
    throw error;
  }

  const isStale = Date.now() - mtimeMs > staleMs;
  const isDead = current ? isPidDead(current.pid) : false;

  if (!isStale && !isDead) throw busyError(current);

  try {
    unlinkSync(path);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }

  if (!tryCreate(path, holder)) throw busyError(readHolder(path));
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

  acquire(path, holder, opts.staleMs ?? defaultStaleMs);

  try {
    return await fn();
  } finally {
    try {
      if (readHolder(path)?.token === holder.token) unlinkSync(path);
    } catch {
      // Release is best effort and must not mask errors from fn().
    }
  }
}
