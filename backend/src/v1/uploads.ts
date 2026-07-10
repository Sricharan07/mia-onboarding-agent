import type { FastifyRequest } from "fastify";
import { createWriteStream } from "node:fs";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createId } from "../utils/id.js";
import { AppError } from "../utils/errors.js";

type UploadKind = "document" | "recording";

export type StoredUpload = {
  filePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  fields: Record<string, string>;
};

export async function storeMultipartUpload(
  request: FastifyRequest,
  uploadRoot: string,
  kind: UploadKind,
  maxBytes: number
): Promise<StoredUpload> {
  const part = await request.file();
  if (!part) throw new AppError("UPLOAD_REQUIRED", "Choose a file to upload.", 400);
  const originalName = basename(part.filename || "upload").slice(0, 255);
  const mimeType = normalizeMime(part.mimetype, originalName, kind);
  const directory = join(uploadRoot, kind === "document" ? "documents" : "recordings");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const extension = extensionFor(mimeType);
  const finalPath = join(directory, `${createId(kind)}${extension}`);
  const temporaryPath = `${finalPath}.partial`;
  try {
    await pipeline(part.file, createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }));
    if (part.file.truncated) throw new AppError("UPLOAD_TOO_LARGE", "The uploaded file exceeds the configured size limit.", 413);
    const file = await stat(temporaryPath);
    if (file.size <= 0) throw new AppError("UPLOAD_EMPTY", "The uploaded file is empty.", 400);
    if (file.size > maxBytes) throw new AppError("UPLOAD_TOO_LARGE", "The uploaded file exceeds the configured size limit.", 413);
    await validateMagic(temporaryPath, mimeType);
    await rename(temporaryPath, finalPath);
    return { filePath: finalPath, originalName, mimeType, size: file.size, fields: readFields(part.fields) };
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function removeStoredUpload(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => undefined);
}

function normalizeMime(value: string, filename: string, kind: UploadKind): string {
  const supplied = value.toLowerCase().split(";", 1)[0]!;
  const extension = extname(filename).toLowerCase();
  const inferred = new Map([
    [".pdf", "application/pdf"], [".md", "text/markdown"], [".markdown", "text/markdown"], [".txt", "text/plain"],
    [".mp4", "video/mp4"], [".webm", "video/webm"], [".mov", "video/quicktime"]
  ]).get(extension);
  const mime = supplied === "application/octet-stream" || !supplied ? inferred : supplied;
  const allowed = kind === "document"
    ? new Set(["application/pdf", "text/markdown", "text/plain"])
    : new Set(["video/mp4", "video/webm", "video/quicktime"]);
  if (!mime || !allowed.has(mime)) {
    throw new AppError(
      kind === "document" ? "DOCUMENT_TYPE_INVALID" : "RECORDING_TYPE_INVALID",
      kind === "document" ? "Upload a PDF, Markdown, or plain-text document." : "Upload an MP4, WebM, or QuickTime recording.",
      400
    );
  }
  return mime;
}

function extensionFor(mimeType: string): string {
  return new Map([
    ["application/pdf", ".pdf"], ["text/markdown", ".md"], ["text/plain", ".txt"],
    ["video/mp4", ".mp4"], ["video/webm", ".webm"], ["video/quicktime", ".mov"]
  ]).get(mimeType) ?? ".bin";
}

async function validateMagic(filePath: string, mimeType: string): Promise<void> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead);
    const valid = mimeType === "application/pdf"
      ? header.subarray(0, 5).toString("ascii") === "%PDF-"
      : mimeType === "video/webm"
        ? header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
        : mimeType === "video/mp4" || mimeType === "video/quicktime"
          ? header.subarray(4, 8).toString("ascii") === "ftyp"
          : !header.includes(0);
    if (!valid) throw new AppError("UPLOAD_CONTENT_INVALID", "The file contents do not match the selected file type.", 400);
  } finally {
    await handle.close();
  }
}

function readFields(fields: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, field] of Object.entries(fields)) {
    if (field && typeof field === "object" && "value" in field && typeof field.value === "string") result[name] = field.value.slice(0, 4_000);
  }
  return result;
}
