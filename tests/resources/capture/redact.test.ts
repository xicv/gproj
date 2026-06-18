import { describe, expect, it } from "vitest";
import { REDACTED_SECRET, redactText, redactValue } from "../../../src/resources/capture/redact.js";

describe("capture redaction", () => {
  it("redacts regex secret corpus and maps exact env values", () => {
    const env = { API_TOKEN: "env-secret-value" };
    const input = [
      "Authorization: Bearer env-secret-value",
      "aws=AKIAABCDEFGHIJKLMNOP",
      "jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.signaturepart",
      "url=https://user:passw0rd@example.test/path",
      "password='plain-secret'",
      "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
    ].join("\n");

    const result = redactText(input, { env });

    expect(result.text).toContain("Bearer env:API_TOKEN");
    expect(result.text).not.toContain("env-secret-value");
    expect(result.text).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(result.text).not.toContain("passw0rd");
    expect(result.text).not.toContain("plain-secret");
    expect(result.text).toContain(REDACTED_SECRET);
  });

  it("redacts high entropy values recursively", () => {
    const value = {
      nested: ["token=abcXYZ1234567890abcXYZ1234567890", { output: "key abcXYZ1234567890abcXYZ1234567890" }],
    };

    const redacted = redactValue(value);

    expect(JSON.stringify(redacted)).not.toContain("abcXYZ1234567890abcXYZ1234567890");
    expect(JSON.stringify(redacted)).toContain(REDACTED_SECRET);
  });
});
