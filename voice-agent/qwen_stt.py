import base64
import os
from typing import Any

import httpx
from livekit import rtc
from livekit.agents import APIConnectOptions, stt
from livekit.agents.types import NOT_GIVEN, NotGivenOr
from livekit.agents.utils import AudioBuffer


class QwenChatCompletionsSTT(stt.STT):
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        endpoint: str = "/chat/completions",
    ) -> None:
        super().__init__(
            capabilities=stt.STTCapabilities(
                streaming=False,
                interim_results=False,
                offline_recognize=True,
            )
        )
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._endpoint = endpoint if endpoint.startswith("/") else f"/{endpoint}"

    @property
    def model(self) -> str:
        return self._model

    @property
    def provider(self) -> str:
        return "qwen"

    async def _recognize_impl(
        self,
        buffer: AudioBuffer,
        *,
        language: NotGivenOr[str] = NOT_GIVEN,
        conn_options: APIConnectOptions,
    ) -> stt.SpeechEvent:
        frame = rtc.combine_audio_frames(buffer) if isinstance(buffer, list) else buffer
        audio_data_uri = f"data:audio/wav;base64,{base64.b64encode(frame.to_wav_bytes()).decode('ascii')}"
        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_audio",
                            "input_audio": {
                                "data": audio_data_uri,
                            },
                        }
                    ],
                }
            ],
            "stream": False,
            "asr_options": {
                "enable_itn": False,
            },
        }

        timeout = httpx.Timeout(conn_options.timeout)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                f"{self._base_url}{self._endpoint}",
                headers={
                    "authorization": f"Bearer {self._api_key}",
                    "content-type": "application/json",
                },
                json=payload,
            )
        if response.status_code >= 400:
            raise RuntimeError(f"Qwen STT failed: HTTP {response.status_code} {response.text[:500]}")

        data = response.json()
        text = extract_text(data).strip()
        return stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT,
            request_id=response.headers.get("x-request-id", ""),
            alternatives=[
                stt.SpeechData(
                    language=language if isinstance(language, str) else "en",
                    text=text,
                    confidence=1.0 if text else 0.0,
                )
            ],
        )


def create_qwen_stt_from_env() -> QwenChatCompletionsSTT | None:
    base_url = os.getenv("STT_BASE_URL")
    api_key = os.getenv("STT_API_KEY")
    model = os.getenv("STT_MODEL")
    endpoint = os.getenv("STT_ENDPOINT", "/chat/completions")
    if not base_url or not api_key or not model:
        return None
    return QwenChatCompletionsSTT(base_url=base_url, api_key=api_key, model=model, endpoint=endpoint)


def extract_text(data: dict[str, Any]) -> str:
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                parts = []
                for item in content:
                    if isinstance(item, dict):
                        value = item.get("text") or item.get("content")
                        if isinstance(value, str):
                            parts.append(value)
                if parts:
                    return " ".join(parts)
    output = data.get("output")
    if isinstance(output, dict):
        for key in ("text", "transcript"):
            value = output.get(key)
            if isinstance(value, str):
                return value
    for key in ("text", "transcript"):
        value = data.get(key)
        if isinstance(value, str):
            return value
    return ""
