import { describe, expect, it } from "vitest";
import { sanitize } from "../../src/redact/sanitize.js";

describe("sanitize", () => {
  it("redacts built-in secrets and literal user redactions while preserving normal prose", () => {
    const text = [
      "normal prose stays readable",
      "openai: sk-abcDEF0123456789_xyz",
      "SERVICE_KEY=super-secret-value",
      "deploy token is literal.*secret",
    ].join("\n");

    const redacted = sanitize(text, ["literal.*secret"]);

    expect(redacted).toContain("normal prose stays readable");
    expect(redacted).not.toContain("sk-abcDEF0123456789_xyz");
    expect(redacted).not.toContain("SERVICE_KEY=super-secret-value");
    expect(redacted).not.toContain("literal.*secret");
    expect(redacted).toContain("[REDACTED]");
  });
});
