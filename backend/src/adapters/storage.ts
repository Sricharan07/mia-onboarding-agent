import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createId } from "../utils/id.js";
import type { FileStorageAdapter } from "./interfaces.js";

export class LocalFileStorageAdapter implements FileStorageAdapter {
  async saveBuffer(input: { buffer: Buffer; filename: string; directory: string }): Promise<{ path: string; sizeBytes: number }> {
    await mkdir(input.directory, { recursive: true });
    const safeName = input.filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const path = join(input.directory, `${createId("upload")}_${safeName}`);
    await writeFile(path, input.buffer);
    return { path, sizeBytes: input.buffer.byteLength };
  }
}
