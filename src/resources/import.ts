import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { resourceAssetDir } from "../format/paths.js";
import { type ResourceCard, type ResourceLink, type ResourceOwns } from "../format/schema.js";

export const textExtensions = new Set([
  ".md",
  ".mmd",
  ".txt",
  ".sh",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".ts",
  ".js",
  ".tsx",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".toml",
  ".ini",
  ".xml",
  ".html",
  ".css",
  ".markdown",
  ".mdx",
  ".text",
]);
const excerptLimit = 240;

export function toPosix(path: string): string {
  return path.split(sep).join("/");
}

export function normalizeText(buffer: Buffer): string {
  return buffer.toString("utf8").replace(/\r\n?/g, "\n");
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function excerpt(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length <= excerptLimit) return trimmed;
  return `${trimmed.slice(0, excerptLimit - 3)}...`;
}

export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "resource";
}

export function titleFromPath(path: string): string {
  const ext = extname(path);
  const name = basename(path, ext).replace(/[-_]+/g, " ").trim();
  return name || basename(path);
}

export function sourcePath(root: string, absolutePath: string): string {
  const rel = relative(root, absolutePath);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return toPosix(rel);
  return absolutePath;
}

export function resourceId(title: string, contentHash: string): string {
  return `${slugify(title)}-${contentHash.slice(0, 12)}`;
}

function assertLocalFile(inputPath: string): void {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(inputPath)) {
    throw new Error("resources add supports local files only");
  }
}

function assetName(id: string, ext: string, contentHash: string): string {
  return `${id}-${contentHash}${ext}`;
}

function writeAsset(root: string, id: string, ext: string, contentHash: string, buffer: Buffer): string {
  const name = assetName(id, ext, contentHash);
  const assetDir = resourceAssetDir(root);
  const assetPath = resolve(assetDir, name);
  mkdirSync(assetDir, { recursive: true });

  if (existsSync(assetPath)) {
    const existingHash = sha256(readFileSync(assetPath));
    if (existingHash !== contentHash) throw new Error(`asset collision for ${name}`);
    return `_assets/${name}`;
  }

  writeFileSync(assetPath, buffer, { flag: "wx" });
  return `_assets/${name}`;
}

export interface FileIdentity {
  contentHash: string;
  contentSize: number;
  kind: "text" | "binary";
  body?: string;
}

export function identityForFile(path: string): FileIdentity {
  const buffer = readFileSync(path);
  const ext = extname(path).toLowerCase();
  if (textExtensions.has(ext)) {
    const body = normalizeText(buffer);
    return {
      contentHash: sha256(body),
      contentSize: Buffer.byteLength(body, "utf8"),
      kind: "text",
      body,
    };
  }

  return {
    contentHash: sha256(buffer),
    contentSize: buffer.length,
    kind: "binary",
  };
}

export interface CreateResourceCardOptions {
  writeAsset?: boolean;
  title?: string;
  category?: string;
  type?: string;
  tags?: string[];
  links?: ResourceLink[];
  intent?: string;
  owns?: ResourceOwns;
  schemaSource?: string[];
}

export function createResourceCard(
  root: string,
  absolutePath: string,
  now: Date = new Date(),
  options: CreateResourceCardOptions = {},
): ResourceCard {
  const buffer = readFileSync(absolutePath);
  const ext = extname(absolutePath).toLowerCase();
  const title = options.title ?? titleFromPath(absolutePath);
  const isText = textExtensions.has(ext);
  const tags = options.tags ?? [];
  const links = options.links && options.links.length > 0 ? options.links : undefined;
  const intent = options.intent ? { intent: options.intent } : {};
  const owns = options.owns ? { owns: options.owns } : {};
  const schemaSource = options.schemaSource && options.schemaSource.length > 0 ? { schemaSource: options.schemaSource } : {};

  if (isText) {
    const body = normalizeText(buffer);
    const contentHash = sha256(body);
    return {
      id: resourceId(title, contentHash),
      type: options.type ?? "text",
      title,
      category: options.category ?? "documents",
      tags,
      timestamp: now.toISOString(),
      body,
      excerpt: excerpt(body),
      sourcePaths: [sourcePath(root, absolutePath)],
      contentHash,
      contentSize: Buffer.byteLength(body, "utf8"),
      ...(links ? { links } : {}),
      ...intent,
      ...owns,
      ...schemaSource,
    };
  }

  const contentHash = sha256(buffer);
  const id = resourceId(title, contentHash);
  const resource = options.writeAsset === false
    ? `_assets/${assetName(id, ext, contentHash)}`
    : writeAsset(root, id, ext, contentHash, buffer);
  return {
    id,
    type: options.type ?? "binary",
    title,
    category: options.category ?? "assets",
    tags,
    timestamp: now.toISOString(),
    resource,
    sourcePaths: [sourcePath(root, absolutePath)],
    contentHash,
    contentSize: buffer.length,
    ...(links ? { links } : {}),
    ...intent,
    ...owns,
    ...schemaSource,
  };
}

export function importResource(root: string, inputPath: string, now: Date = new Date(), options: CreateResourceCardOptions = {}): ResourceCard {
  assertLocalFile(inputPath);
  const absolutePath = resolve(root, inputPath);
  if (!existsSync(absolutePath)) throw new Error(`resource file not found: ${inputPath}`);
  if (!statSync(absolutePath).isFile()) throw new Error(`resource path is not a file: ${inputPath}`);
  return createResourceCard(root, absolutePath, now, options);
}
