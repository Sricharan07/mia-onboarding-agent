import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { AppError } from "../utils/errors.js";

const PREFIX = "enc:v1";
const IV_BYTES = 12;

export function encryptSecret(plainText: string, keyMaterial: string | undefined): string {
  const key = deriveKey(keyMaterial);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptSecret(value: string, keyMaterial: string | undefined): string {
  const [, version, ivEncoded, tagEncoded, encryptedEncoded] = value.split(":");
  if (version !== "v1" || !ivEncoded || !tagEncoded || !encryptedEncoded) {
    throw new AppError("SECRET_ENCRYPTION_INVALID", "Stored secret is malformed.", 500);
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(keyMaterial), Buffer.from(ivEncoded, "base64url"));
    decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedEncoded, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new AppError("SECRET_DECRYPTION_FAILED", "Stored secret could not be decrypted. Check MIA_SECRET_ENCRYPTION_KEY.", 500);
  }
}

function deriveKey(keyMaterial: string | undefined): Buffer {
  if (!keyMaterial?.trim()) {
    throw new AppError("SECRET_ENCRYPTION_KEY_REQUIRED", "MIA_SECRET_ENCRYPTION_KEY is required to store encrypted credentials.", 500);
  }
  const trimmed = keyMaterial.trim();
  for (const encoding of ["base64url", "base64", "hex"] as const) {
    const decoded = Buffer.from(trimmed, encoding);
    if (decoded.length === 32) return decoded;
  }
  return createHash("sha256").update(trimmed).digest();
}
