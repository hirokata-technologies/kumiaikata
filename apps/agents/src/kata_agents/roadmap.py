"""Roadmap planning: the proposal the Project Manager puts in front of the user.

The agents never write to the roadmap. `propose_roadmap` only records a draft; the
Kata app shows its arguments as an editable card, and nothing is created until the
user confirms it there.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, Field

PROPOSE_ROADMAP = "propose_roadmap"

PLANNING_CONTEXT_KEY = "planning_context"
"""Session state key the Kata app fills when it opens a planning conversation."""

ProjectPriority = Literal["urgent", "high", "medium", "low"]


class ProposedGoal(BaseModel):
    title: Annotated[str, Field(min_length=1, max_length=200)]
    """Short name of the outcome, e.g. "Clinical notes without typing"."""

    body: Annotated[str, Field(max_length=4000)] = ""
    """Why it matters and how the team will know it is done, in plain language."""

    priority: Annotated[int, Field(ge=1, le=5)] = 3
    """1 is the highest priority, 5 the lowest."""


class ProposedProject(BaseModel):
    title: Annotated[str, Field(min_length=1, max_length=200)]
    body: Annotated[str, Field(max_length=4000)] = ""
    """What the project delivers and why it comes in this order."""

    priority: ProjectPriority = "medium"
    impact: Annotated[int, Field(ge=1, le=100)] = 50
    """How much the project moves the goal, 1 to 100."""

    effort: Annotated[int, Field(ge=1, le=10)] = 5
    """How much work it is, 1 (a day or two) to 10 (a quarter or more)."""


def propose_roadmap(
    projects: list[ProposedProject],
    goal: ProposedGoal | None = None,
    goal_id: str | None = None,
) -> dict[str, object]:
    """Show the user a draft goal and its projects to review, edit and confirm.

    Call this once the user has agreed on the direction. Pass `goal` for a new goal,
    or `goal_id` to add projects to a goal that already exists. Calling it again
    replaces the previous draft. The user creates the items themselves; never say
    they have been created.

    Args:
      projects: The projects to propose, in the order they should run.
      goal: The new goal, when the conversation is planning a new one.
      goal_id: The id of an existing goal, when adding projects to it.
    """
    if (goal is None) == (goal_id is None):
        return {"status": "error", "message": "Pass exactly one of goal or goal_id."}
    if goal is None and not projects:
        return {"status": "error", "message": "Propose at least one project for the goal."}
    return {
        "status": "proposed",
        "projects": len(projects),
        "next": "Tell the user to review the draft and press Create when it looks right.",
    }
