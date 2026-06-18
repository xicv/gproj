import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookCommand, installStopHook } from "../../../src/resources/capture/hook.js";

describe("capture hook installer", () => {
  it("installs idempotently and uninstalls the Stop hook", () => {
    const home = mkdtempSync(join(tmpdir(), "gproj-home-"));

    const first = installStopHook({ home });
    const second = installStopHook({ home });
    const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));

    expect(first).toContain(hookCommand);
    expect(second).toContain(hookCommand);
    expect(settings.hooks.Stop.flatMap((entry: { hooks: Array<{ command: string }> }) => entry.hooks)
      .filter((hook: { command: string }) => hook.command === hookCommand)).toHaveLength(1);

    const uninstalled = installStopHook({ home, uninstall: true });
    const after = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));

    expect(uninstalled).toContain(hookCommand);
    expect(after.hooks.Stop).toEqual([]);
  });
});
