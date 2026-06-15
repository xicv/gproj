import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export interface LockInfo {
  exists: boolean;
  pid?: number;
  label?: string;
  stale: boolean;
  dead: boolean;
}

export interface LockHolder {
  pid: number;
  label: string;
  ts: number;
  token: string;
}

const defaultStaleMs = 120_000;
export const lockPath = (root: string) => join(root, ".gproj", ".lock");

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function isPidDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return isNodeError(error) && error.code === "ESRCH";
  }
}

export function readHolder(root: string): LockHolder | null {
  try {
    const parsed = JSON.parse(readFileSync(lockPath(root), "utf8")) as Partial<LockHolder>;
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

export function isLockStale(root: string, staleMs: number): boolean {
  return Date.now() - statSync(lockPath(root)).mtimeMs > staleMs;
}

export function inspectLock(root: string, staleMs = defaultStaleMs): LockInfo {
  const path = lockPath(root);
  if (!existsSync(path)) return { exists: false, stale: false, dead: false };
  const holder = readHolder(root);
  const stale = isLockStale(root, staleMs);
  const dead = holder ? isPidDead(holder.pid) : false;
  return { exists: true, pid: holder?.pid, label: holder?.label, stale, dead };
}

export function clearRecoverableLock(root: string, staleMs = defaultStaleMs): boolean {
  const info = inspectLock(root, staleMs);
  if (!info.exists || (!info.dead && !info.stale)) return false;
  try {
    unlinkSync(lockPath(root));
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}
