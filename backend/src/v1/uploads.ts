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
  const mimeType = normalizeUploadMime(part.mimetype, originalName, kind);
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
    await validateUploadContent(temporaryPath, mimeType);
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

export function normalizeUploadMime(value: string, filename: string, kind: UploadKind): string {
  const rawSupplied = value.toLowerCase().split(";", 1)[0]!;
  const supplied = new Map([
    ["audio/x-wav", "audio/wav"],
    ["audio/wave", "audio/wav"],
    ["audio/x-m4a", "audio/mp4"]
  ]).get(rawSupplied) ?? rawSupplied;
  const extension = extname(filename).toLowerCase();
  const inferred = new Map([
    [".pdf", "application/pdf"], [".md", "text/markdown"], [".markdown", "text/markdown"], [".txt", "text/plain"],
    [".mp4", "video/mp4"], [".webm", "video/webm"], [".mov", "video/quicktime"],
    [".mp3", "audio/mpeg"], [".wav", "audio/wav"], [".m4a", "audio/mp4"]
  ]).get(extension);
  const mime = supplied === "application/octet-stream" || !supplied ? inferred : supplied;
  const allowed = kind === "document"
    ? new Set(["application/pdf", "text/markdown", "text/plain"])
    : new Set(["video/mp4", "video/webm", "video/quicktime", "audio/mpeg", "audio/wav", "audio/mp4", "audio/webm"]);
  if (!mime || !allowed.has(mime)) {
    throw new AppError(
      kind === "document" ? "DOCUMENT_TYPE_INVALID" : "RECORDING_TYPE_INVALID",
      kind === "document"
        ? "Upload a PDF, Markdown, or plain-text document."
        : "Upload an MP4, MOV, WebM, MP3, WAV, or M4A recording.",
      400
    );
  }
  return mime;
}

function extensionFor(mimeType: string): string {
  return new Map([
    ["application/pdf", ".pdf"], ["text/markdown", ".md"], ["text/plain", ".txt"],
    ["video/mp4", ".mp4"], ["video/webm", ".webm"], ["video/quicktime", ".mov"],
    ["audio/mpeg", ".mp3"], ["audio/wav", ".wav"], ["audio/mp4", ".m4a"], ["audio/webm", ".webm"]
  ]).get(mimeType) ?? ".bin";
}

export async function validateUploadContent(filePath: string, mimeType: string): Promise<void> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead);
    if (!matchesUploadMagic(header, mimeType)) {
      throw new AppError("UPLOAD_CONTENT_INVALID", "The file contents do not match the selected file type.", 400);
    }
  } finally {
    await handle.close();
  }
}

function matchesUploadMagic(header: Buffer, mimeType: string): boolean {
  if (mimeType === "application/pdf") return header.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "video/webm" || mimeType === "audio/webm") {
    return header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  }
  if (mimeType === "video/mp4" || mimeType === "video/quicktime" || mimeType === "audio/mp4") {
    return header.subarray(4, 8).toString("ascii") === "ftyp";
  }
  if (mimeType === "audio/wav") {
    return header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WAVE";
  }
  if (mimeType === "audio/mpeg") {
    return header.subarray(0, 3).toString("ascii") === "ID3"
      || header.length >= 2 && header[0] === 0xff && (header[1]! & 0xe0) === 0xe0;
  }
  return !header.includes(0);
}

function readFields(fields: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, field] of Object.entries(fields)) {
    if (field && typeof field === "object" && "value" in field && typeof field.value === "string") result[name] = field.value.slice(0, 4_000);
  }
  return result;
}
