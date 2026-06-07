import { AppError } from "../utils/errors.js";

export async function requestJson<T>(input: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<T> {
  const response = await fetch(input.url, {
    method: input.method ?? "POST",
    headers: {
      "content-type": "application/json",
      ...input.headers
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body)
  });

  const text = await response.text();
  const parsed = text ? safeJson(text) : {};

  if (!response.ok) {
    throw new AppError("PROVIDER_ERROR", `Provider request failed: ${response.status} ${response.statusText}`, 502, parsed);
  }

  return parsed as T;
}

export function joinUrl(baseUrl: string, endpoint: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
