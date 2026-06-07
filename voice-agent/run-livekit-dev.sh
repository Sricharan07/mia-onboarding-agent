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
  grep -E "^${key}=" "$file" | tail -1 | cut -d= -f2-
}

LIVEKIT_API_KEY_VALUE="${LIVEKIT_API_KEY:-$(load_env_key LIVEKIT_API_KEY)}"
LIVEKIT_API_SECRET_VALUE="${LIVEKIT_API_SECRET:-$(load_env_key LIVEKIT_API_SECRET)}"

if [ -z "$LIVEKIT_API_KEY_VALUE" ] || [ -z "$LIVEKIT_API_SECRET_VALUE" ]; then
  echo "LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set in .env" >&2
  exit 1
fi

export LIVEKIT_API_KEY="$LIVEKIT_API_KEY_VALUE"
export LIVEKIT_API_SECRET="$LIVEKIT_API_SECRET_VALUE"
export LIVEKIT_KEYS="${LIVEKIT_API_KEY_VALUE}: ${LIVEKIT_API_SECRET_VALUE}"

exec .bin/livekit-server --dev --keys "$LIVEKIT_KEYS"
