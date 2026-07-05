import { extname } from "node:path";
import { ValidationAppError } from "../../utils/errors.js";

const allowedVideoMimeTypes = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/mpeg"
]);

const allowedVideoExtensions = new Set([".mp4", ".mov", ".webm", ".mkv", ".mpeg", ".mpg"]);

export function validateWorkflowVideoUpload(file: { buffer: Buffer; filename: string; mimetype: string }): void {
  const mimeType = normalizeMimeType(file.mimetype);
  if (!allowedVideoMimeTypes.has(mimeType)) {
    throw new ValidationAppError("Workflow upload must be an MP4, MOV, WebM, MKV, or MPEG video.", { mimeType: file.mimetype });
  }

  const extension = extname(file.filename).toLowerCase();
  if (!allowedVideoExtensions.has(extension)) {
    throw new ValidationAppError("Workflow upload filename must use a supported video extension.", { filename: file.filename });
  }

  if (!looksLikeVideoContainer(file.buffer, mimeType)) {
    throw new ValidationAppError("Workflow upload content does not match a supported video container.");
  }
}

function normalizeMimeType(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() ?? "";
}

function looksLikeVideoContainer(buffer: Buffer, mimeType: string): boolean {
  if (buffer.byteLength < 4) return false;
  if (mimeType === "video/webm" || mimeType === "video/x-matroska") {
    return buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  }
  if (mimeType === "video/mpeg") {
    return buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && (buffer[3] === 0xba || buffer[3] === 0xb3);
  }
  return buffer.byteLength >= 12 && buffer.toString("ascii", 4, 8) === "ftyp";
}
