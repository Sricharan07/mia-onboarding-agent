# MIA LiveKit Voice Agent

This is a local LiveKit voice worker. Moss is used only by the backend for workflow/UI-map indexing and retrieval.

## Env

`voice-agent/.env` needs:

```bash
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
MIA_BACKEND_URL=http://localhost:4000
MIA_BACKEND_API_KEY=local_api_key_with_runtime_write_scope
QWEN_API_KEY=
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3.6-plus
QWEN_VOICE_MODEL=qwen3-tts-flash
QWEN_TTS_BASE_URL=https://dashscope-intl.aliyuncs.com/api/v1
QWEN_TTS_ENDPOINT=/services/aigc/multimodal-generation/generation
QWEN_TTS_VOICE=Cherry
STT_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
STT_API_KEY=
STT_ENDPOINT=/chat/completions
STT_MODEL=qwen3-asr-flash
```

## Run

Terminal 1:

```bash
livekit-server --dev
```

Terminal 2:

```bash
npm run dev:backend
```

Terminal 3:

```bash
cd voice-agent
./run-local.sh
```

Then open the SDK demo. The browser connects to LiveKit using a backend-minted token; this worker joins the room and calls the backend resolver for every user request.
