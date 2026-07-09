import { AppError } from "../utils/errors.js";
import type { AppConfig } from "../config/env.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_RETRY_DELAY_MS = 10_000;

type ProviderRequestInput = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  attempts?: number;
  maxResponseBytes?: number;
};

export async function requestJson<T>(input: ProviderRequestInput): Promise<T> {
  const response = await requestWithRetry(input);
  const text = await readProviderResponse(input, () => readResponseText(response, input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES));

  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new AppError("PROVIDER_JSON_ERROR", "Provider returned invalid JSON.", 502);
  }
}

export async function requestBytes(input: Omit<ProviderRequestInput, "body">): Promise<Buffer> {
  const response = await requestWithRetry(input);
  return readProviderResponse(input, () => readResponseBytes(response, input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES));
}

async function requestWithRetry(input: ProviderRequestInput): Promise<Response> {
  const attempts = Math.max(1, Math.min(input.attempts ?? DEFAULT_ATTEMPTS, 5));
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (input.signal?.aborted) throw providerAbortedError(input.signal.reason);

    try {
      const response = await fetch(input.url, {
        method: input.method ?? "POST",
        headers: {
          "content-type": "application/json",
          ...input.headers
        },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        redirect: "error",
        signal: combinedSignal(input.signal, timeoutMs)
      });

      if (response.ok) return response;

      const shouldRetry = isRetryableStatus(response.status) && attempt < attempts;
      if (shouldRetry) {
        await discardResponse(response);
        await retryDelay(attempt, response.headers.get("retry-after") ?? undefined, input.signal);
        continue;
      }

      const details = await readProviderError(response, input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
      throw new AppError("PROVIDER_ERROR", `Provider request failed: ${response.status} ${response.statusText}`, 502, details);
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (input.signal?.aborted) throw providerAbortedError(input.signal.reason);
      if (attempt < attempts && isRetryableNetworkError(error)) {
        await retryDelay(attempt, undefined, input.signal);
        continue;
      }
      if (isAbortError(error)) {
        throw new AppError("PROVIDER_TIMEOUT", `Provider request exceeded ${timeoutMs}ms.`, 502);
      }
      throw new AppError("PROVIDER_NETWORK_ERROR", "Provider request could not be completed.", 502);
    }
  }

  throw new AppError("PROVIDER_ERROR", "Provider request failed after all attempts.", 502);
}

export function joinUrl(baseUrl: string, endpoint: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
}

export function providerRequestPolicy(config: AppConfig): Pick<ProviderRequestInput, "timeoutMs" | "attempts" | "maxResponseBytes"> {
  return {
    timeoutMs: config.PROVIDER_REQUEST_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
    attempts: config.PROVIDER_RETRY_ATTEMPTS ?? DEFAULT_ATTEMPTS,
    maxResponseBytes: config.PROVIDER_RESPONSE_MAX_BYTES ?? DEFAULT_MAX_RESPONSE_BYTES
  };
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function readProviderError(response: Response, maxBytes: number): Promise<unknown> {
  try {
    const text = await readResponseText(response, Math.min(maxBytes, 64 * 1024));
    if (!text) return { status: response.status };
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { status: response.status, body: text };
    }
  } catch {
    return { status: response.status };
  }
}

async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  return (await readResponseBytes(response, maxBytes)).toString("utf8");
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await discardResponse(response);
    throw new AppError("PROVIDER_RESPONSE_TOO_LARGE", `Provider response exceeded ${maxBytes} bytes.`, 502);
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AppError("PROVIDER_RESPONSE_TOO_LARGE", `Provider response exceeded ${maxBytes} bytes.`, 502);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function discardResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableNetworkError(error: unknown): boolean {
  return isAbortError(error) || error instanceof TypeError || (error instanceof Error && ["ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND"].includes((error as Error & { code?: string }).code ?? ""));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function providerAbortedError(reason: unknown): AppError {
  return new AppError("PROVIDER_REQUEST_ABORTED", "Provider request was cancelled.", 503, reason instanceof Error ? reason.message : undefined);
}

async function retryDelay(attempt: number, retryAfter: string | undefined, signal: AbortSignal | undefined): Promise<void> {
  const serverDelay = parseRetryAfter(retryAfter);
  const exponentialCap = Math.min(250 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
  const delayMs = serverDelay ?? Math.floor(Math.random() * exponentialCap);
  if (delayMs <= 0) return;
  if (signal?.aborted) throw providerAbortedError(signal.reason);

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(providerAbortedError(signal?.reason));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function readProviderResponse<T>(input: ProviderRequestInput, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (input.signal?.aborted) throw providerAbortedError(input.signal.reason);
    if (isAbortError(error)) {
      throw new AppError("PROVIDER_TIMEOUT", `Provider response exceeded ${input.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms.`, 502);
    }
    throw new AppError("PROVIDER_NETWORK_ERROR", "Provider response could not be read.", 502);
  }
}

function parseRetryAfter(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, MAX_RETRY_DELAY_MS);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.min(date - Date.now(), MAX_RETRY_DELAY_MS));
}
