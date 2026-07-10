import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { AppError } from "../utils/errors.js";

export type PublicDocument = {
  url: string;
  contentType: string;
  body: Buffer;
};

export async function fetchPublicDocument(
  rawUrl: string,
  options: { maxBytes: number; timeoutMs: number; signal?: AbortSignal; redirects?: number }
): Promise<PublicDocument> {
  const redirects = options.redirects ?? 0;
  if (redirects > 5) throw new AppError("DOCUMENT_REDIRECT_LIMIT", "Documentation URL redirected too many times.", 400);
  const { url, address, family } = await resolvePublicHttpsUrl(rawUrl);
  const response = await requestBuffer(url, address, family, options);
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    const rawLocation = response.headers.location;
    const location = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;
    if (!location) throw new AppError("DOCUMENT_REDIRECT_INVALID", "Documentation redirect did not include a location.", 400);
    return fetchPublicDocument(new URL(location, url).toString(), { ...options, redirects: redirects + 1 });
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new AppError("DOCUMENT_FETCH_FAILED", `Documentation server returned HTTP ${response.statusCode}.`, 400);
  }
  return {
    url: url.toString(),
    contentType: String(response.headers["content-type"] ?? "application/octet-stream").split(";", 1)[0]!.trim().toLowerCase(),
    body: response.body
  };
}

export async function resolvePublicHttpsUrl(rawUrl: string): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError("DOCUMENT_URL_INVALID", "Documentation URL is invalid.", 400);
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new AppError("DOCUMENT_URL_INVALID", "Documentation URLs must use public HTTPS without credentials or a custom port.", 400);
  }
  url.hash = "";
  const literalFamily = isIP(url.hostname.replace(/^\[|\]$/g, ""));
  const addresses = literalFamily
    ? [{ address: url.hostname.replace(/^\[|\]$/g, ""), family: literalFamily }]
    : await lookup(url.hostname, { all: true, verbatim: true }).catch(() => {
        throw new AppError("DOCUMENT_DNS_FAILED", "Documentation hostname could not be resolved.", 400);
      });
  if (addresses.length === 0 || addresses.some((entry) => !isPublicIp(entry.address))) {
    throw new AppError("DOCUMENT_URL_PRIVATE", "Documentation URL resolves to a private or reserved network.", 400);
  }
  const selected = addresses[0]!;
  return { url, address: selected.address, family: selected.family as 4 | 6 };
}

export function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split(".").map(Number);
    if (a === undefined || b === undefined || c === undefined) return false;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    const mapped = normalized.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped) return isPublicIp(mapped);
    const first = Number.parseInt(normalized.split(":", 1)[0] || "0", 16);
    return first >= 0x2000 && first <= 0x3fff && !normalized.startsWith("2001:db8:") && normalized !== "2001:db8::";
  }
  return false;
}

function requestBuffer(
  url: URL,
  address: string,
  family: 4 | 6,
  options: { maxBytes: number; timeoutMs: number; signal?: AbortSignal }
): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const pinnedLookup = ((
      _hostname: string,
      _options: unknown,
      callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void
    ) => callback(null, address, family)) as LookupFunction;
    const incoming = request(url, {
      method: "GET",
      lookup: pinnedLookup,
      signal: options.signal,
      timeout: options.timeoutMs,
      headers: {
        accept: "text/html, text/markdown, text/plain, application/pdf;q=0.9",
        "accept-encoding": "identity",
        "user-agent": "MiaDocumentationIndexer/1.0"
      }
    }, (response) => {
      const declared = Number(response.headers["content-length"] ?? 0);
      if (declared > options.maxBytes) {
        response.destroy();
        reject(new AppError("DOCUMENT_TOO_LARGE", "Documentation response exceeds the configured size limit.", 400));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > options.maxBytes) {
          response.destroy(new AppError("DOCUMENT_TOO_LARGE", "Documentation response exceeds the configured size limit.", 400));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({
        statusCode: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks)
      }));
      response.on("error", reject);
    });
    incoming.on("timeout", () => incoming.destroy(new AppError("DOCUMENT_FETCH_TIMEOUT", "Documentation request timed out.", 408)));
    incoming.on("error", (error) => reject(error instanceof AppError ? error : new AppError("DOCUMENT_FETCH_FAILED", "Documentation URL could not be fetched.", 400)));
    incoming.end();
  });
}
