import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { requestJson } from "../src/adapters/http.js";
import { AppError } from "../src/utils/errors.js";

test("provider HTTP retries transient responses and returns bounded JSON", async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    if (requests < 3) {
      response.writeHead(503, { "content-type": "application/json", "retry-after": "0" });
      response.end(JSON.stringify({ error: "temporarily unavailable" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });

  try {
    const result = await requestJson<{ ok: boolean }>({
      url: await listen(server),
      attempts: 3,
      timeoutMs: 1_000,
      maxResponseBytes: 1_024
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(requests, 3);
  } finally {
    await close(server);
  }
});

test("provider HTTP reports timeouts without leaking fetch errors", async () => {
  const server = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    }, 100);
  });

  try {
    await assert.rejects(
      requestJson({ url: await listen(server), attempts: 1, timeoutMs: 10 }),
      (error) => error instanceof AppError && error.code === "PROVIDER_TIMEOUT"
    );
  } finally {
    await close(server);
  }
});

test("provider HTTP rejects oversized responses", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ value: "x".repeat(2_000) }));
  });

  try {
    await assert.rejects(
      requestJson({ url: await listen(server), attempts: 1, maxResponseBytes: 128 }),
      (error) => error instanceof AppError && error.code === "PROVIDER_RESPONSE_TOO_LARGE"
    );
  } finally {
    await close(server);
  }
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP address.");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
