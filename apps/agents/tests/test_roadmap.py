import pytest
from google.adk.agents import LlmAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.flows.llm_flows.prompt._instructions_utils import inject_session_state
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic import ValidationError

from kata_agents import project_manager
from kata_agents.roadmap import (
    PLANNING_CONTEXT_KEY,
    PROPOSE_ROADMAP,
    ProposedGoal,
    ProposedProject,
    propose_roadmap,
)
from kata_agents.settings import ModelSettings

SETTINGS = ModelSettings(
    model="gemini-3.8-flash",
    location="global",
    thinking_level=types.ThinkingLevel.HIGH,
)


def tool_names(agent: LlmAgent) -> set[str]:
    return {getattr(tool, "name", getattr(tool, "__name__", "")) for tool in agent.tools}


def test_the_project_manager_can_propose_a_roadmap() -> None:
    pm = project_manager.build_project_manager(SETTINGS)

    assert PROPOSE_ROADMAP in tool_names(pm)
    assert propose_roadmap.__name__ == PROPOSE_ROADMAP


def test_a_new_goal_may_be_proposed_with_its_projects() -> None:
    result = propose_roadmap(
        projects=[ProposedProject(title="Dictation", impact=70, effort=4)],
        goal=ProposedGoal(title="Notes without typing", priority=2),
    )

    assert result["status"] == "proposed"
    assert result["projects"] == 1


def test_a_new_goal_may_be_proposed_on_its_own() -> None:
    assert propose_roadmap(projects=[], goal=ProposedGoal(title="Notes"))["status"] == "proposed"


def test_projects_for_an_existing_goal_need_at_least_one_project() -> None:
    assert propose_roadmap(projects=[], goal_id="g1")["status"] == "error"


@pytest.mark.parametrize("goal_id", [None, "g1"])
def test_exactly_one_of_goal_and_goal_id_is_required(goal_id: str | None) -> None:
    goal = ProposedGoal(title="Notes") if goal_id else None
    result = propose_roadmap(projects=[ProposedProject(title="P")], goal=goal, goal_id=goal_id)

    assert result["status"] == "error"


@pytest.mark.parametrize(
    "fields",
    [{"impact": 0}, {"impact": 101}, {"effort": 0}, {"effort": 11}, {"priority": "soon"}],
)
def test_project_estimates_stay_in_the_apps_ranges(fields: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        ProposedProject.model_validate({"title": "P", **fields})


def test_goal_priority_is_one_to_five() -> None:
    with pytest.raises(ValidationError):
        ProposedGoal(title="Notes", priority=6)


async def _instruction(state: dict[str, object]) -> str:
    pm = project_manager.build_project_manager(SETTINGS)
    service = InMemorySessionService()
    session = await service.create_session(app_name="kata", user_id="u", state=state)
    context = InvocationContext(
        session_service=service,
        invocation_id="i",
        agent=pm,
        session=session,
    )
    assert isinstance(pm.instruction, str)
    return await inject_session_state(pm.instruction, ReadonlyContext(context))


async def test_the_planning_context_reaches_the_project_managers_instruction() -> None:
    text = await _instruction({PLANNING_CONTEXT_KEY: "Plan a new goal in workspace Default."})

    assert "Plan a new goal in workspace Default." in text


async def test_conversations_without_a_planning_context_still_work() -> None:
    text = await _instruction({})

    assert "Planning context:" in text
    assert "{" not in text
