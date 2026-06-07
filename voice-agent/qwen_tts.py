import base64
import os
import uuid
from typing import Any

import httpx
from livekit.agents import APIConnectOptions, DEFAULT_API_CONNECT_OPTIONS, tts


class QwenTextToSpeech(tts.TTS):
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        endpoint: str = "/services/aigc/multimodal-generation/generation",
        voice: str = "Cherry",
    ) -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=24_000,
            num_channels=1,
        )
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._endpoint = endpoint if endpoint.startswith("/") else f"/{endpoint}"
        self._voice = voice

    @property
    def model(self) -> str:
        return self._model

    @property
    def provider(self) -> str:
        return "qwen"

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> tts.ChunkedStream:
        return QwenTtsChunkedStream(tts=self, input_text=text, conn_options=conn_options)


class QwenTtsChunkedStream(tts.ChunkedStream):
    def __init__(self, *, tts: QwenTextToSpeech, input_text: str, conn_options: APIConnectOptions) -> None:
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._qwen_tts = tts

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        payload = {
            "model": self._qwen_tts._model,
            "input": {
                "text": self.input_text,
                "voice": self._qwen_tts._voice,
                "language_type": "Auto",
            },
        }

        async with httpx.AsyncClient(timeout=httpx.Timeout(30, connect=self._conn_options.timeout)) as client:
            response = await client.post(
                f"{self._qwen_tts._base_url}{self._qwen_tts._endpoint}",
                headers={
                    "authorization": f"Bearer {self._qwen_tts._api_key}",
                    "content-type": "application/json",
                },
                json=payload,
            )

        try:
            data = response.json()
        except ValueError:
            data = {}

        if response.status_code >= 400:
            message = data.get("message") if isinstance(data, dict) else None
            raise RuntimeError(f"Qwen TTS failed: HTTP {response.status_code} {message or response.text[:500]}")

        audio = data.get("output", {}).get("audio", {}) if isinstance(data, dict) else {}
        audio_bytes = await resolve_audio_bytes(audio, self._qwen_tts._api_key)
        request_id = response.headers.get("x-request-id") or data.get("request_id") or str(uuid.uuid4())

        output_emitter.initialize(
            request_id=request_id,
            sample_rate=self._qwen_tts.sample_rate,
            num_channels=self._qwen_tts.num_channels,
            mime_type="audio/wav",
        )
        output_emitter.push(audio_bytes)
        output_emitter.flush()


async def resolve_audio_bytes(audio: dict[str, Any], api_key: str) -> bytes:
    data = audio.get("data")
    if isinstance(data, str) and data:
        return base64.b64decode(data)

    url = audio.get("url")
    if isinstance(url, str) and url:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(url, headers={"authorization": f"Bearer {api_key}"})
        if response.status_code >= 400:
            raise RuntimeError(f"Qwen TTS audio download failed: HTTP {response.status_code} {response.text[:500]}")
        return response.content

    raise RuntimeError("Qwen TTS response did not include audio data or URL.")


def create_qwen_tts_from_env() -> QwenTextToSpeech:
    base_url = os.getenv("QWEN_TTS_BASE_URL")
    api_key = os.getenv("QWEN_API_KEY")
    model = os.getenv("QWEN_VOICE_MODEL")
    endpoint = os.getenv("QWEN_TTS_ENDPOINT", "/services/aigc/multimodal-generation/generation")
    voice = os.getenv("QWEN_TTS_VOICE", "Cherry")
    missing = [
        name
        for name, value in {
            "QWEN_TTS_BASE_URL": base_url,
            "QWEN_API_KEY": api_key,
            "QWEN_VOICE_MODEL": model,
        }.items()
        if not value
    ]
    if missing:
        raise RuntimeError(f"Qwen TTS is not configured. Missing: {', '.join(missing)}.")
    return QwenTextToSpeech(base_url=base_url, api_key=api_key, model=model, endpoint=endpoint, voice=voice)
