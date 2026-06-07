# MIA Moss Voice Agent

This worker is the Moss Voice Agent side of the voice architecture.

The browser SDK connects to the Moss voice server using a token minted by the backend. Moss handles STT, LLM orchestration, and TTS. This worker calls the MIA backend resolver as a tool, and the backend emits typed workflow events to the SDK.

## Environment

Create `voice-agent/.env` for local runs or push these through the Moss Agent CLI for deployments:

```bash
MIA_BACKEND_URL=http://localhost:4000
MIA_BACKEND_API_KEY=local_api_key_with_runtime_write_scope
MOSS_PROJECT_ID=
MOSS_PROJECT_KEY=
MOSS_VOICE_AGENT_ID=
```

`MIA_BACKEND_API_KEY` needs the `runtime:write` scope.

## Local Run

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python agent.py console
```

## Deploy

```bash
pip install moss-agent-cli
moss-agent deploy
moss-agent env push
```

The `.env` file is local-only; push runtime variables with `moss-agent env push` after deploys or rotations.
