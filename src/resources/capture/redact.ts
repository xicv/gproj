const REDACTED_SECRET = "[REDACTED:secret]";

export interface RedactionOptions {
  env?: NodeJS.ProcessEnv;
}

export interface RedactionResult {
  text: string;
  replacements: number;
  sources: string[];
}

interface RedactionContext {
  env: NodeJS.ProcessEnv;
  replacements: number;
  sources: Set<string>;
}

function entropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let total = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    total -= p * Math.log2(p);
  }
  return total;
}

function sourceForSecret(secret: string, env: NodeJS.ProcessEnv): string | null {
  if (secret.length < 4) return null;
  for (const [name, value] of Object.entries(env)) {
    if (!value || value.length < 4) continue;
    if (value === secret) return `env:${name}`;
  }
  return null;
}

const SAFE_REFERENCE_RE = /^(?:env|keychain|mcp):[A-Za-z0-9_.\/-]+$/;

function isSafeReference(secret: string): boolean {
  return secret === REDACTED_SECRET || SAFE_REFERENCE_RE.test(secret);
}

function replacement(secret: string, context: RedactionContext): string {
  if (isSafeReference(secret)) return secret;
  context.replacements += 1;
  const source = sourceForSecret(secret, context.env);
  const mapped = source ?? REDACTED_SECRET;
  context.sources.add(mapped);
  return mapped;
}

function replaceFullSecret(text: string, pattern: RegExp, context: RedactionContext): string {
  return text.replace(pattern, (match: string) => replacement(match, context));
}

function looksLikeHighEntropyToken(value: string): boolean {
  if (value.length < 24) return false;
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return false;
  if (/^[a-f0-9]{32,}$/i.test(value)) return false;
  if (/^[0-9]+$/.test(value)) return false;
  return entropy(value) >= 4.0;
}

function redactHighEntropy(text: string, context: RedactionContext): string {
  return text.replace(/\b[A-Za-z0-9_+/=-]{24,}\b/g, (token) => {
    if (!looksLikeHighEntropyToken(token)) return token;
    return replacement(token, context);
  });
}

export function redactText(input: string, options: RedactionOptions = {}): RedactionResult {
  const context: RedactionContext = {
    env: options.env ?? process.env,
    replacements: 0,
    sources: new Set<string>(),
  };

  let text = input;
  text = replaceFullSecret(text, /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g, context);
  text = text.replace(/([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^@\s/]+)@/gi, (_match, protocol: string, _user: string, pass: string) => {
    return `${protocol}${replacement(pass, context)}@`;
  });
  text = text.replace(/\bBearer\s+([A-Za-z0-9._~+/=-]{12,})/gi, (_match, token: string) => {
    return `Bearer ${replacement(token, context)}`;
  });
  text = replaceFullSecret(text, /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, context);
  text = replaceFullSecret(text, /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, context);
  text = text.replace(
    /\b([A-Za-z0-9_.-]*(?:api[_-]?key|token|secret|password|passwd|pwd)[A-Za-z0-9_.-]*["']?\s*[:=]\s*["'])([^"'\n\r]{4,})(["'])/gi,
    (_match, prefix: string, secret: string, suffix: string) => `${prefix}${replacement(secret, context)}${suffix}`,
  );
  text = text.replace(
    /\b([A-Za-z0-9_.-]*(?:api[_-]?key|token|secret|password|passwd|pwd)[A-Za-z0-9_.-]*\s*[:=]\s*)([^\s,;{}"']{6,})/gi,
    (_match, prefix: string, secret: string) => `${prefix}${replacement(secret, context)}`,
  );
  text = redactHighEntropy(text, context);

  return { text, replacements: context.replacements, sources: [...context.sources].sort() };
}

function redactArray(values: unknown[], options: RedactionOptions): unknown[] {
  return values.map((value) => redactValue(value, options));
}

function redactObject(value: Record<string, unknown>, options: RedactionOptions): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) redacted[key] = redactValue(item, options);
  return redacted;
}

export function redactValue(value: unknown, options: RedactionOptions = {}): unknown {
  if (typeof value === "string") return redactText(value, options).text;
  if (Array.isArray(value)) return redactArray(value, options);
  if (value && typeof value === "object") return redactObject(value as Record<string, unknown>, options);
  return value;
}

export function containsUnredactedSecret(value: unknown, options: RedactionOptions = {}): boolean {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return redactText(serialized, options).replacements > 0;
}

export { REDACTED_SECRET };
