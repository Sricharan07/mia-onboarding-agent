import assert from "node:assert/strict";

export const consoleRoutes = [
  ["Setup", "/setup"],
  ["Overview", "/overview"],
  ["Knowledge", "/knowledge"],
  ["Skills", "/skills"],
  ["Actions & Safety", "/actions"],
  ["Test Mia", "/test-mia"],
  ["Runs", "/runs"],
  ["Settings", "/settings"]
];

export function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function booleanEnvironment(name, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

export async function requestJson(url, init = {}) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message ?? response.statusText;
    throw new Error(`${init.method ?? "GET"} ${url} failed (${response.status}): ${message}`);
  }
  return payload;
}

export async function waitForJson(url, predicate, timeoutMs = 60_000, init = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await requestJson(url, init);
      if (predicate(value)) return value;
      lastError = new Error(`The response from ${url} was not ready.`);
    } catch (error) {
      lastError = error;
    }
    await wait(500);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function loginAdmin(backendUrl, email, password) {
  const result = await requestJson(`${backendUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  assert.match(result.token ?? "", /^mia_admin_/, "Admin login did not return a Mia session token.");
  return result.token;
}

export function adminHeaders(token, contentType = true) {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/json",
    ...(contentType ? { "content-type": "application/json" } : {})
  };
}

export function assertNoAxeViolations(result, label) {
  const violations = result.violations ?? [];
  assert.deepEqual(
    violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes?.slice(0, 5).map((node) => ({
        target: node.target,
        html: node.html,
        failure: node.failureSummary
      }))
    })),
    [],
    `${label} has WCAG violations`
  );
}

export function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
