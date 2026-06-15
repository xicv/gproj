import { readState } from "../format/store.js";

const NEXT: Record<string, string> = {
  init: "run `gproj package` to plan phase 1",
  planning: "run `gproj package` to emit the phase packet",
  packaged: "run `gproj exec` to execute the phase",
  reviewing: "run `gproj review` to review the executor's evidence",
  deciding: "run `gproj decide accept|adjust|reject`",
  done: "project complete",
};

export function renderStatus(root: string): string {
  const s = readState(root);
  if (!s) return "gproj: not initialized (run `gproj init \"<goal>\"`)";
  return `gproj: phase ${s.currentPhase}, status ${s.status}\nnext: ${NEXT[s.status] ?? "(unknown)"}`;
}
