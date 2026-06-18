import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { catalogEntries } from "../src/catalog.js";

interface DiscoveredCommand {
  name: string;
  file: string;
  line: number;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function caseCommands(source: string, file: string, prefix = "", baseLine = 1): DiscoveredCommand[] {
  const commands: DiscoveredCommand[] = [];
  const regex = /case "([^"]+)":/g;
  for (const match of source.matchAll(regex)) {
    const name = match[1];
    const index = match.index ?? 0;
    commands.push({ name: `${prefix}${name}`, file, line: baseLine + lineOf(source, index) - 1 });
  }
  return commands;
}

function functionBody(source: string, startNeedle: string, endNeedle: string): { body: string; baseLine: number } {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  expect(start, `${startNeedle} not found`).toBeGreaterThanOrEqual(0);
  expect(end, `${endNeedle} not found`).toBeGreaterThan(start);
  return { body: source.slice(start, end), baseLine: lineOf(source, start) };
}

function discoveredCommands(): DiscoveredCommand[] {
  const cliFile = "src/cli.ts";
  const resourcesFile = "src/commands/resources.ts";
  const cliSource = readFileSync(join(process.cwd(), cliFile), "utf8");
  const resourcesSource = readFileSync(join(process.cwd(), resourcesFile), "utf8");
  const runResources = functionBody(
    resourcesSource,
    "export async function runResources",
    "export function isResourcesMutation",
  );
  const runCapture = functionBody(
    resourcesSource,
    "async function runCapture",
    "export async function runResources",
  );

  const resources = caseCommands(runResources.body, resourcesFile, "resources ", runResources.baseLine);
  const capture = caseCommands(runCapture.body, resourcesFile, "resources capture ", runCapture.baseLine);
  const captureDefaultIndex = runCapture.body.indexOf("case undefined:");
  const captureDefault = captureDefaultIndex >= 0
    ? [{ name: "resources capture", file: resourcesFile, line: runCapture.baseLine + lineOf(runCapture.body, captureDefaultIndex) - 1 }]
    : [];

  return [
    ...caseCommands(cliSource, cliFile),
    ...resources,
    ...capture,
    ...captureDefault,
  ];
}

describe("catalog anti-rot coverage", () => {
  it("represents every CLI command and resources subverb", () => {
    const catalogNames = new Set(catalogEntries.map((entry) => entry.name));
    const missing = discoveredCommands()
      .filter((command, index, commands) => commands.findIndex((candidate) => candidate.name === command.name) === index)
      .filter((command) => !catalogNames.has(command.name));
    const diagnostics = missing.map((command) => `${command.file}:${command.line} missing catalog entry for ${command.name}`);

    expect(missing, diagnostics.join("\n")).toEqual([]);
  });
});
