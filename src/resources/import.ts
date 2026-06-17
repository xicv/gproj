import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { resourceAssetDir } from "../format/paths.js";
import { type ResourceCard } from "../format/schema.js";

const textExtensions = new Set([".md", ".txt"]);
const excerptLimit = 240;

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function normalizeText(buffer: Buffer): string {
  return buffer.toString("utf8").replace(/\r\n?/g, "\n");
}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function excerpt(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length <= excerptLimit) return trimmed;
  return `${trimmed.slice(0, excerptLimit - 3)}...`;
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "resource";
}

function titleFromPath(path: string): string {
  const ext = extname(path);
  const name = basename(path, ext).replace(/[-_]+/g, " ").trim();
  return name || basename(path);
}

function sourcePath(root: string, absolutePath: string): string {
  const rel = relative(root, absolutePath);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return toPosix(rel);
  return absolutePath;
}

function resourceId(title: string, contentHash: string): string {
  return `${slugify(title)}-${contentHash.slice(0, 12)}`;
}

function assertLocalFile(inputPath: string): void {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(inputPath)) {
    throw new Error("resources add supports local files only");
  }
}

function writeAsset(root: string, ext: string, contentHash: string, buffer: Buffer): string {
  const assetName = `${contentHash}${ext}`;
  const assetDir = resourceAssetDir(root);
  const assetPath = resolve(assetDir, assetName);
  mkdirSync(assetDir, { recursive: true });

  if (existsSync(assetPath)) {
    const existingHash = sha256(readFileSync(assetPath));
    if (existingHash !== contentHash) throw new Error(`asset collision for ${assetName}`);
    return `_assets/${assetName}`;
  }

  writeFileSync(assetPath, buffer, { flag: "wx" });
  return `_assets/${assetName}`;
}

export function importResource(root: string, inputPath: string, now: Date = new Date()): ResourceCard {
  assertLocalFile(inputPath);
  const absolutePath = resolve(root, inputPath);
  if (!existsSync(absolutePath)) throw new Error(`resource file not found: ${inputPath}`);
  if (!statSync(absolutePath).isFile()) throw new Error(`resource path is not a file: ${inputPath}`);

  const buffer = readFileSync(absolutePath);
  const ext = extname(absolutePath).toLowerCase();
  const title = titleFromPath(absolutePath);
  const isText = textExtensions.has(ext);

  if (isText) {
    const body = normalizeText(buffer);
    const contentHash = sha256(body);
    return {
      id: resourceId(title, contentHash),
      type: "text",
      title,
      category: "documents",
      tags: [],
      timestamp: now.toISOString(),
      body,
      excerpt: excerpt(body),
      sourcePaths: [sourcePath(root, absolutePath)],
      contentHash,
    };
  }

  const contentHash = sha256(buffer);
  const resource = writeAsset(root, ext, contentHash, buffer);
  return {
    id: resourceId(title, contentHash),
    type: "binary",
    title,
    category: "assets",
    tags: [],
    timestamp: now.toISOString(),
    resource,
    sourcePaths: [sourcePath(root, absolutePath)],
    contentHash,
  };
}
