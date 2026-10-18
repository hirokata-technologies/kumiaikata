# Kata agents

The AI Project Manager and AI Strategist, built with
[Google ADK 2.0](https://adk.dev/) and hosted on Agent Runtime in Google Cloud
(`kumiaikata` project, Singapore region).

## How it works

```
kumiai app (Cloud Run) ──► Agent Runtime (asia-southeast1)
                         └─ project_manager   coordinator the user talks to
                              └─ strategist   sub-agent, mode="task"
```

- The **Project Manager** plans work, tracks progress and hands strategic
  questions to the Strategist.
- The **Strategist** runs in task mode: it can ask the user clarifying
  questions, then hands control back with a summary (Goal, Options,
  Recommendation, First steps).
- Both use **Gemini 3.8 Flash** with a **high** thinking level. The model is
  only served from the `global`, `us` and `eu` endpoints, so the agents call
  the `global` endpoint even though they run in Singapore.
- Agent Runtime stores sessions and Memory Bank memories, so nothing is kept in
  the running instance. It scales to zero when idle.

## Roadmap planning

"New goal" and "Plan projects for this goal" on the Roadmap open a planning
conversation:

1. The **Project Manager** asks about the outcome, why it matters now, how the
   team will know it is done, and how urgent it is.
2. It brings in the **Strategist**, who splits the goal into projects, in
   order, with impact (1 to 100), effort (1 to 10) and priority.
3. The Project Manager calls `propose_roadmap` (`roadmap.py`). The app shows
   the call's arguments as an editable draft, and the user creates the items.
   The agents never write to the roadmap themselves.

The Kata API opens these sessions with a `planning_context` state value
(the workspace's goals and projects, and the goal being extended), which the
Project Manager's instruction reads as `{planning_context?}`.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `KATA_AGENTS_MODEL` | `gemini-3.8-flash` | Gemini model ID |
| `KATA_AGENTS_MODEL_LOCATION` | `global` | Model endpoint location |
| `KATA_AGENTS_THINKING_LEVEL` | `HIGH` | `LOW`, `MEDIUM` or `HIGH` |

Production values live in `src/kata_agents/.agent_engine_config.json`, along
with the runtime service account and scaling limits.

## Development

Requires [uv](https://docs.astral.sh/uv/).

```bash
cd apps/agents
uv sync                       # install dependencies
uv run pytest                 # tests
uv run ruff format .          # format
uv run ruff check .           # lint
uv run mypy                   # type check

# Chat with the agents locally. This uses application default credentials,
# which must belong to a hirokata.dev account with access to kumiaikata
# (gcloud --configuration hirokata auth application-default login).
GOOGLE_GENAI_USE_ENTERPRISE=1 GOOGLE_CLOUD_PROJECT=kumiaikata uv run adk web src
```

Add a dependency with `uv add <package>`; it updates `uv.lock`, which must be
committed.

## Deployment

Merging to `main` runs `.github/workflows/deploy-agents.yml`, which runs the
tests and then `scripts/deploy.sh`. The script exports `requirements.txt`
from `uv.lock` and runs `adk deploy agent_engine` against the Agent Runtime
instance created by Terraform (see `infra/README.md`).

To deploy by hand (also uses application default credentials, see above):

```bash
AGENT_RUNTIME_ID=<terraform output agent_runtime_id> ./scripts/deploy.sh
```

To check a deployment end to end, run a real two-message conversation and
confirm the Strategist takes part:

```bash
AGENT_RUNTIME_ID=<terraform output agent_runtime_id> uv run --group deploy python scripts/smoke_test.py
```

## Workspaces

Every session must be scoped to one workspace. The Kata API passes a user ID of
the form `<workspace_id>:<user_id>` so sessions and memories from different
domain workspaces never mix.
