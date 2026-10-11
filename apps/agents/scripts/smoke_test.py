"""Sends a real conversation to the deployed agents and prints who answered.

Usage:
    AGENT_RUNTIME_ID=<id> uv run --group deploy python scripts/smoke_test.py

Uses application default credentials. The user ID is workspace-scoped, the
same way the Kata API will call the agents.
"""

import asyncio
import os
import sys
from typing import Any

import vertexai

PROJECT = os.environ.get("GCP_PROJECT_ID", "kumiaikata")
REGION = os.environ.get("GCP_REGION", "asia-southeast1")
USER_ID = "smoke-test-workspace:smoke-test-user"

MESSAGES = [
    "We want to add a team calendar to Kata next quarter, but we only have two "
    "developers. Should we build it ourselves or integrate Google Calendar? "
    "Please get a strategic recommendation.",
    "Both developers are full-stack. Success means teams can see shared "
    "deadlines in one place within three months. Budget is small.",
]


def describe(event: dict[str, Any]) -> str | None:
    author = event.get("author", "?")
    parts = (event.get("content") or {}).get("parts") or []
    for part in parts:
        if part.get("text") and not part.get("thought"):
            return f"[{author}] {part['text'].strip()[:600]}"
        if part.get("function_call"):
            return f"[{author}] calls {part['function_call'].get('name')}"
    return None


async def main() -> int:
    agent_id = os.environ["AGENT_RUNTIME_ID"]
    client = vertexai.Client(project=PROJECT, location=REGION)
    agent = client.agent_engines.get(
        name=f"projects/{PROJECT}/locations/{REGION}/reasoningEngines/{agent_id}"
    )

    session = await agent.async_create_session(user_id=USER_ID)
    session_id = session["id"] if isinstance(session, dict) else session.id
    authors: set[str] = set()
    try:
        for message in MESSAGES:
            print(f"\n>>> {message}")
            async for event in agent.async_stream_query(
                user_id=USER_ID, session_id=session_id, message=message
            ):
                authors.add(event.get("author", "?"))
                line = describe(event)
                if line:
                    print(line)
    finally:
        await agent.async_delete_session(user_id=USER_ID, session_id=session_id)

    print(f"\nAgents that answered: {sorted(authors)}")
    return 0 if "strategist" in authors else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
