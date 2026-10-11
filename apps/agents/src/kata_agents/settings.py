"""Model settings shared by every agent.

Values come from environment variables so they can change per deployment
without a code change. The defaults are the production values.
"""

import os
from dataclasses import dataclass

from google.genai import types


@dataclass(frozen=True)
class ModelSettings:
    model: str
    """Gemini model ID."""

    location: str
    """Model endpoint location. Gemini 3.8 Flash is only served from `global`, `us`
    and `eu`, so this differs from the Agent Runtime region (asia-southeast1)."""

    thinking_level: types.ThinkingLevel
    """How much the model thinks before answering."""


# Gemini 3.8 Flash rejects MINIMAL, so only these levels are allowed.
THINKING_LEVELS = {
    level.value: level
    for level in (types.ThinkingLevel.LOW, types.ThinkingLevel.MEDIUM, types.ThinkingLevel.HIGH)
}


def load_model_settings() -> ModelSettings:
    level = os.environ.get("KATA_AGENTS_THINKING_LEVEL", "HIGH").upper()
    if level not in THINKING_LEVELS:
        raise ValueError(
            f"KATA_AGENTS_THINKING_LEVEL must be one of {sorted(THINKING_LEVELS)}, got {level!r}"
        )

    return ModelSettings(
        model=os.environ.get("KATA_AGENTS_MODEL", "gemini-3.8-flash"),
        location=os.environ.get("KATA_AGENTS_MODEL_LOCATION", "global"),
        thinking_level=THINKING_LEVELS[level],
    )
