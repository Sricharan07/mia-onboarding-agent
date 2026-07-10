import assert from "node:assert/strict";
import test from "node:test";
import { BackendClient } from "../src/client/backendClient.js";

test("backend client parses agent SSE events and caches runtime tokens", async () => {
  const originalFetch = globalThis.fetch;
  let tokenCalls = 0;
  const requests: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    requests.push({ url: String(input), authorization: headers.get("authorization") });
    const response = {
      sessionId: "session_1", revision: 2, status: "completed", assessment: "Grounded",
      progress: "Done", type: "answer", message: "The pipeline is on this page.", actions: []
    };
    const body = [
      `event: thinking\ndata: {"message":"Understanding"}\n\n`,
      `event: progress\ndata: {"assessment":"Grounded","progress":"Done"}\n\n`,
      `event: answer\ndata: ${JSON.stringify(response)}\n\n`
    ].join("");
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  try {
    const client = new BackendClient({
      backendUrl: "http://localhost:4000/",
      tokenProvider: async () => {
        tokenCalls += 1;
        return { token: "runtime-token", expiresAt: new Date(Date.now() + 600_000).toISOString() };
      }
    });
    const events: string[] = [];
    const result = await client.submitTurn({
      sessionId: "session_1",
      revision: 1,
      utterance: "Where is the pipeline?",
      source: "text",
      observation: observation(),
      actions: [],
      context: []
    }, (event) => events.push(event.type));
    assert.equal(result.type, "answer");
    assert.deepEqual(events, ["thinking", "progress", "answer"]);
    assert.equal(tokenCalls, 1);
    assert.equal(requests[0]?.authorization, "Bearer runtime-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function observation() {
  return {
    id: "observation_1",
    revision: 1,
    url: "http://localhost:3001/dashboard/crm",
    route: "/dashboard/crm",
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
    nodes: []
  };
}
