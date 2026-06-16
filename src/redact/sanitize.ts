function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitize(text: string, redactions: string[] = []): string {
  let sanitized = text;

  sanitized = sanitized.replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED]");
  sanitized = sanitized.replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED]");
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._-]{8,}/g, "[REDACTED]");
  sanitized = sanitized.replace(
    /((?:api[_-]?key|token|secret|password)\s*[:=]\s*['"]?)[A-Za-z0-9._-]{8,}/gi,
    "$1[REDACTED]",
  );
  sanitized = sanitized.replace(/^[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*.+$/gm, "[REDACTED]");

  for (const redaction of redactions) {
    if (!redaction) continue;
    sanitized = sanitized.replace(new RegExp(escapeRegExp(redaction), "g"), "[REDACTED]");
  }

  return sanitized;
}
