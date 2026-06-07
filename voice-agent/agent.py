import logging
import os
import asyncio
from typing import Any

import httpx
from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    RunContext,
    WorkerOptions,
    cli,
    function_tool,
)
from livekit.plugins import openai, silero
from qwen_stt import create_qwen_stt_from_env
from qwen_tts import create_qwen_tts_from_env

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mia-livekit-agent")

MIA_BACKEND_URL = os.environ["MIA_BACKEND_URL"].rstrip("/")
MIA_BACKEND_API_KEY = os.environ["MIA_BACKEND_API_KEY"]
QWEN_API_KEY = os.getenv("QWEN_API_KEY")
QWEN_BASE_URL = os.getenv("QWEN_BASE_URL")
QWEN_MODEL = os.getenv("RUNTIME_LLM_MODEL") or os.getenv("QWEN_MODEL")
STT_BASE_URL = os.getenv("STT_BASE_URL")
STT_API_KEY = os.getenv("STT_API_KEY")
STT_MODEL = os.getenv("STT_MODEL")
LIVEKIT_AGENT_NAME = os.getenv("LIVEKIT_AGENT_NAME", "mia-onboarding-agent")


class MiaWorkflowAgent(Agent):
    def __init__(self, voice_session_id: str):
        super().__init__(
            instructions="""
You are Mia, a concise SaaS onboarding voice assistant.

For every user request, call resolve_mia_request first and speak the returned
message. Do not invent browser actions, selectors, or workflow steps. The web
SDK executes only reviewed workflows returned by the backend.
"""
        )
        self.voice_session_id = voice_session_id

    @function_tool
    async def resolve_mia_request(self, context: RunContext, utterance: str) -> str:
        """Resolve the user's utterance through the MIA onboarding backend."""
        logger.info("Resolving user utterance via backend: %r", utterance)
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{MIA_BACKEND_URL}/api/v1/voice/sessions/{self.voice_session_id}/resolve",
                headers={"authorization": f"Bearer {MIA_BACKEND_API_KEY}"},
                json={"utterance": utterance},
            )
            response.raise_for_status()
            payload = response.json()
            message = payload.get("message")
            resolved = str(message or "I could not resolve that request yet.")
            logger.info("Backend resolved response: %r", resolved)
            return resolved


async def entrypoint(ctx: JobContext):
    logger.info("Worker received job for room %s", ctx.room.name)
    await ctx.connect()

    voice_session_id = extract_voice_session_id(ctx.room.name)
    logger.info("Connected to room %s for voice_session_id=%s", ctx.room.name, voice_session_id)

    session = AgentSession(
        stt=create_stt(),
        llm=create_llm(),
        tts=create_tts(),
        vad=silero.VAD.load(),
    )
    attach_session_logs(session, voice_session_id)

    await session.start(agent=MiaWorkflowAgent(voice_session_id), room=ctx.room)
    await session.say("Mia is listening. Ask me to help with the CRM workflow.", allow_interruptions=True)


def extract_voice_session_id(room_name: str) -> str:
    prefix = "mia-"
    if not room_name.startswith(prefix):
        raise ValueError(f"Unexpected MIA room name: {room_name}")
    return room_name[len(prefix):]


def create_stt():
    qwen_stt = create_qwen_stt_from_env()
    if qwen_stt:
        logger.info("Using Qwen STT model=%s base_url=%s", STT_MODEL, STT_BASE_URL)
        return qwen_stt

    raise RuntimeError("Qwen STT is not configured. Missing: STT_BASE_URL, STT_API_KEY, or STT_MODEL.")


def create_llm():
    missing = [
        name
        for name, value in {
            "QWEN_API_KEY": QWEN_API_KEY,
            "QWEN_BASE_URL": QWEN_BASE_URL,
            "RUNTIME_LLM_MODEL or QWEN_MODEL": QWEN_MODEL,
        }.items()
        if not value
    ]
    if missing:
        raise RuntimeError(f"Qwen LLM is not configured. Missing: {', '.join(missing)}.")

    logger.info("Using Qwen LLM model=%s base_url=%s", QWEN_MODEL, QWEN_BASE_URL)
    return openai.LLM(model=QWEN_MODEL, api_key=QWEN_API_KEY, base_url=QWEN_BASE_URL)


def create_tts():
    logger.info("Using Qwen TTS")
    return create_qwen_tts_from_env()


def attach_session_logs(session: AgentSession, voice_session_id: str) -> None:
    def log_event(name: str):
        def handler(event: Any) -> None:
            logger.info("session event %s %s", name, compact_event(event))
            if name == "user_input_transcribed":
                transcript = getattr(event, "transcript", None)
                is_final = getattr(event, "is_final", False)
                if is_final and isinstance(transcript, str) and transcript.strip():
                    asyncio.create_task(push_user_transcript(voice_session_id, transcript.strip()))

        return handler

    for name in [
        "user_state_changed",
        "agent_state_changed",
        "user_input_transcribed",
        "conversation_item_added",
        "function_tools_executed",
        "speech_created",
        "error",
        "close",
    ]:
        session.on(name, log_event(name))


async def push_user_transcript(voice_session_id: str, transcript: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{MIA_BACKEND_URL}/api/v1/voice/sessions/{voice_session_id}/transcript",
                headers={"authorization": f"Bearer {MIA_BACKEND_API_KEY}"},
                json={"text": transcript},
            )
            response.raise_for_status()
    except Exception as error:
        logger.warning("Failed to publish user transcript to backend: %s", error)


def compact_event(event: Any) -> dict[str, Any]:
    if hasattr(event, "model_dump"):
        data = event.model_dump(exclude={"speech_handle"}, mode="json")
    elif hasattr(event, "__dict__"):
        data = dict(event.__dict__)
    else:
        return {"value": str(event)}

    if "item" in data and isinstance(data["item"], dict):
        item = data["item"]
        data["item"] = {
            "role": item.get("role"),
            "text_content": item.get("text_content") or item.get("content"),
        }
    if "function_calls" in data:
        data["function_calls"] = [
            {"name": call.get("name"), "arguments": call.get("arguments")}
            for call in data.get("function_calls", [])
            if isinstance(call, dict)
        ]
    if "function_call_outputs" in data:
        data["function_call_outputs"] = [
            {"output": output.get("output")}
            for output in data.get("function_call_outputs", [])
            if isinstance(output, dict)
        ]
    if "error" in data:
        data["error"] = str(data["error"])
    return data


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name=LIVEKIT_AGENT_NAME))
