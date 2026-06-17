import { appendNdjson, readNdjson } from "./store.js";

export type JournalEvent =
  "package_start" |
  "package_done" |
  "exec_start" |
  "exec_done" |
  "review_start" |
  "review_done" |
  "decide" |
  "sandbox_apply" |
  "sandbox_discard" |
  "recover" |
  "resource-added" |
  "abort";

export interface JournalEntry {
  ts: string;
  phase: number;
  event: JournalEvent;
  status?: string;
  runId?: string;
  detail?: string;
}

export function appendJournal(root: string, entry: Omit<JournalEntry, "ts">): void {
  appendNdjson(root, "history.ndjson", { ts: new Date().toISOString(), ...entry });
}

export function readJournal(root: string): JournalEntry[] {
  return readNdjson(root, "history.ndjson") as JournalEntry[];
}
