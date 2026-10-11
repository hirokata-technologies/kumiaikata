import json
from collections.abc import Callable
from pathlib import Path

import pytest
from google.adk.agents import LlmAgent
from google.adk.models import Gemini
from google.genai import types

from kata_agents import project_manager, strategist
from kata_agents.settings import ModelSettings, load_model_settings

SETTINGS = ModelSettings(
    model="gemini-3.8-flash",
    location="global",
    thinking_level=types.ThinkingLevel.HIGH,
)


def tool_names(agent: LlmAgent) -> set[str]:
    return {getattr(tool, "name", "") for tool in agent.tools}


def test_root_agent_is_the_project_manager() -> None:
    from kata_agents.agent import root_agent

    assert root_agent.name == project_manager.NAME


def test_project_manager_hands_off_to_the_strategist_as_a_task() -> None:
    pm = project_manager.build_project_manager(SETTINGS)

    [sub_agent] = pm.sub_agents
    assert isinstance(sub_agent, LlmAgent)
    assert sub_agent.name == strategist.NAME
    assert sub_agent.mode == "task"
    # ADK exposes a task-mode sub-agent to its parent as a delegation tool.
    assert strategist.NAME in tool_names(pm)


def test_strategist_can_finish_its_task() -> None:
    agent = strategist.build_strategist(SETTINGS)

    assert agent.mode == "task"
    assert agent.sub_agents == []
    assert "finish_task" in tool_names(agent)


@pytest.mark.parametrize(
    "build", [project_manager.build_project_manager, strategist.build_strategist]
)
def test_agents_use_gemini_on_the_global_endpoint_with_high_thinking(
    build: Callable[[ModelSettings], LlmAgent],
) -> None:
    agent = build(SETTINGS)

    assert isinstance(agent.model, Gemini)
    assert agent.model.model == "gemini-3.8-flash"
    assert agent.model.client_kwargs == {"enterprise": True, "location": "global"}
    assert agent.generate_content_config is not None
    thinking = agent.generate_content_config.thinking_config
    assert thinking is not None
    assert thinking.thinking_level == types.ThinkingLevel.HIGH


def test_settings_default_to_production_values(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("KATA_AGENTS_MODEL", "KATA_AGENTS_MODEL_LOCATION", "KATA_AGENTS_THINKING_LEVEL"):
        monkeypatch.delenv(name, raising=False)

    assert load_model_settings() == SETTINGS


def test_settings_read_overrides_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KATA_AGENTS_MODEL", "gemini-3.7-flash")
    monkeypatch.setenv("KATA_AGENTS_MODEL_LOCATION", "us")
    monkeypatch.setenv("KATA_AGENTS_THINKING_LEVEL", "medium")

    assert load_model_settings() == ModelSettings(
        model="gemini-3.7-flash",
        location="us",
        thinking_level=types.ThinkingLevel.MEDIUM,
    )


@pytest.mark.parametrize("level", ["extreme", "minimal"])
def test_settings_reject_an_unsupported_thinking_level(
    monkeypatch: pytest.MonkeyPatch, level: str
) -> None:
    monkeypatch.setenv("KATA_AGENTS_THINKING_LEVEL", level)

    with pytest.raises(ValueError, match="KATA_AGENTS_THINKING_LEVEL"):
        load_model_settings()


def test_deploy_config_matches_the_default_settings() -> None:
    config_path = Path(__file__).parents[1] / "src" / "kata_agents" / ".agent_engine_config.json"
    env = json.loads(config_path.read_text())["env_vars"]

    assert env == {
        "KATA_AGENTS_MODEL": SETTINGS.model,
        "KATA_AGENTS_MODEL_LOCATION": SETTINGS.location,
        "KATA_AGENTS_THINKING_LEVEL": SETTINGS.thinking_level.value,
    }
