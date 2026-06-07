#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
ROOT_DIR="$(cd .. && pwd)"

load_env_key() {
  local key="$1"
  local file="$ROOT_DIR/.env"
  if [ ! -f "$file" ]; then
    return 0
  fi
  grep -E "^${key}=" "$file" | tail -1 | cut -d= -f2- || true
}

for key in LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET LIVEKIT_AGENT_NAME QWEN_API_KEY QWEN_BASE_URL QWEN_MODEL RUNTIME_LLM_MODEL QWEN_VOICE_MODEL QWEN_TTS_BASE_URL QWEN_TTS_ENDPOINT QWEN_TTS_VOICE STT_BASE_URL STT_API_KEY STT_ENDPOINT STT_MODEL; do
  if [ -z "${!key:-}" ]; then
    value="$(load_env_key "$key")"
    if [ -n "$value" ]; then
      export "$key=$value"
    fi
  fi
done

PATH="$PWD/.bin:$PATH" .venv/bin/python agent.py dev
