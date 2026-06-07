import os

import httpx
from dotenv import load_dotenv
from moss_voice_agent_manager import (
    Agent,
    AutoSubscribe,
    JobContext,
    MossAgentSession,
    MossConfig,
    RunContext,
    WorkerOptions,
    WorkerType,
    cli,
    llm,
)

load_dotenv()

MIA_BACKEND_URL = os.environ["MIA_BACKEND_URL"].rstrip("/")
MIA_BACKEND_API_KEY = os.environ["MIA_BACKEND_API_KEY"]


class MiaWorkflowAgent(Agent):
    instructions = """
You are Mia, a product onboarding voice assistant.

For every user request, call resolve_mia_request first. The tool returns the
only response you should speak to the user. Do not invent browser actions,
selectors, or workflow steps. The web SDK executes only reviewed workflows
returned by the backend.
"""

    def __init__(self, voice_session_id: str):
        super().__init__(instructions=self.instructions)
        self.voice_session_id = voice_session_id

    @llm.function_tool
    async def resolve_mia_request(self, context: RunContext, utterance: str) -> str:
        """Resolve the user's utterance through the MIA onboarding backend."""
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{MIA_BACKEND_URL}/api/v1/voice/sessions/{self.voice_session_id}/resolve",
                headers={"authorization": f"Bearer {MIA_BACKEND_API_KEY}"},
                json={"utterance": utterance},
            )
            response.raise_for_status()
            payload = response.json()
            message = payload.get("message")
            return str(message or "I could not resolve that request yet.")


async def entrypoint(ctx: JobContext):
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    voice_session_id = extract_voice_session_id(ctx.room.name)
    session = MossAgentSession(userdata=None, ctx=ctx, max_tool_steps=10)

    async def on_shutdown():
        await session.submit_session_report(ctx, ctx.room.name)

    ctx.add_shutdown_callback(on_shutdown)
    await session.start(agent=MiaWorkflowAgent(voice_session_id), room=ctx.room)


def extract_voice_session_id(room_name: str) -> str:
    prefix = "mia-"
    if not room_name.startswith(prefix):
        raise ValueError(f"Unexpected MIA room name: {room_name}")
    return room_name[len(prefix):]


def run():
    moss_config = MossConfig.from_platform()
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            ws_url=moss_config.platform_ws_url,
            api_key=moss_config.platform_api_key,
            api_secret=moss_config.platform_api_secret,
            agent_name=moss_config.voice_agent_name,
            worker_type=WorkerType.ROOM,
            prewarm_fnc=MossAgentSession.prewarm,
        )
    )


if __name__ == "__main__":
    run()
