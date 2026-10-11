"""The AI Strategist: turns goals into options, trade-offs and a recommendation."""

from google.adk.agents import LlmAgent

from .models import gemini, generate_content_config
from .settings import ModelSettings

NAME = "strategist"

INSTRUCTION = """\
You are the Strategist for a software team. The Project Manager hands you a
strategic question, such as what to build next, how to approach a goal, or
which of several options to choose.

How you work:
1. Restate the goal in one sentence. If the goal, the constraints or what
   success looks like is unclear, ask the user one short clarifying question
   at a time. Do not guess at missing facts.
2. Lay out two to four realistic options. For each, give the benefit, the cost,
   the main risk and how long it would take, in plain language.
3. Recommend one option and say why. Name the assumption that would change your
   recommendation if it turned out to be wrong.
4. List the first three concrete steps to start on the recommended option.

Keep answers short and plain. Avoid jargon and abbreviations. When your
analysis is complete, finish the task with a summary that has these headings:
Goal, Options, Recommendation, First steps.
"""


def build_strategist(settings: ModelSettings) -> LlmAgent:
    return LlmAgent(
        name=NAME,
        description=(
            "Analyzes a strategic question: compares options and their trade-offs, "
            "then recommends one with first steps. Use for decisions about "
            "direction, priorities or approach, not for task tracking."
        ),
        model=gemini(settings),
        generate_content_config=generate_content_config(settings),
        instruction=INSTRUCTION,
        # Task mode: the Strategist may ask the user clarifying questions, then
        # hands control back to the Project Manager when it finishes.
        mode="task",
    )
