"""Builds the Gemini model and generation config used by the agents."""

from google.adk.models import Gemini
from google.genai import types

from .settings import ModelSettings


def gemini(settings: ModelSettings) -> Gemini:
    return Gemini(
        model=settings.model,
        client_kwargs={"enterprise": True, "location": settings.location},
    )


def generate_content_config(settings: ModelSettings) -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(thinking_level=settings.thinking_level),
    )
