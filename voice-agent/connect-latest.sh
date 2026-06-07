#!/usr/bin/env bash
set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/.." && pwd)"

ROOM_NAME="$(
  cd "$ROOT_DIR"
  node - <<'NODE'
const fs = require("fs");
function parseEnv(path) {
  const env = {};
  if (!fs.existsSync(path)) return env;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
  }
  return env;
}
const demo = parseEnv("example/demo-crm+sdk/.env.local");
const fallback = parseEnv("example/demo-crm+sdk/.env");
const backendUrl = (demo.NEXT_PUBLIC_MIA_BACKEND_URL || fallback.NEXT_PUBLIC_MIA_BACKEND_URL || "http://localhost:4000").replace(/\/+$/, "");
const apiKey = demo.NEXT_PUBLIC_MIA_API_KEY || fallback.NEXT_PUBLIC_MIA_API_KEY;
if (!apiKey) {
  console.error("NEXT_PUBLIC_MIA_API_KEY is missing in example/demo-crm+sdk/.env");
  process.exit(1);
}
fetch(`${backendUrl}/api/v1/voice/sessions`, {
  headers: { authorization: `Bearer ${apiKey}` }
})
  .then(async (response) => {
    if (!response.ok) throw new Error(`Backend returned ${response.status}: ${await response.text()}`);
    return response.json();
  })
  .then((sessions) => {
    const latest = sessions.at(-1);
    if (!latest?.roomName) throw new Error("No active voice session found. Open the demo until the cursor says Listening first.");
    console.log(latest.roomName);
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
NODE
)"

cd "$AGENT_DIR"
echo "Connecting Mia voice agent to room: $ROOM_NAME"
exec .venv/bin/python agent.py connect --room "$ROOM_NAME"
