#!/usr/bin/env bash
# Deploys the agent code to the Agent Runtime instance that Terraform created.
#
# Required environment variables:
#   AGENT_RUNTIME_ID  Agent Runtime instance ID (terraform output agent_runtime_id)
# Optional:
#   GCP_PROJECT_ID    defaults to kumiaikata
#   GCP_REGION        defaults to asia-southeast1
set -euo pipefail

cd "$(dirname "$0")/.."

: "${AGENT_RUNTIME_ID:?Set AGENT_RUNTIME_ID to the Agent Runtime instance ID}"
project="${GCP_PROJECT_ID:-kumiaikata}"
region="${GCP_REGION:-asia-southeast1}"
agent_dir="src/kata_agents"
trap 'rm -f "$agent_dir/requirements.txt" "$agent_dir/.env"' EXIT

# Agent Runtime installs dependencies from requirements.txt in the agent folder.
# Generate it from the lock file so production matches what was tested.
uv export --frozen --no-dev --no-hashes --no-emit-project --output-file "$agent_dir/requirements.txt" >/dev/null

# `adk deploy` replaces the env_vars in .agent_engine_config.json with the
# contents of the agent folder's .env file, so write that file from the config.
python3 -c '
import json, sys
env = json.load(open(sys.argv[1]))["env_vars"]
print("\n".join(f"{name}={value}" for name, value in env.items()))
' "$agent_dir/.agent_engine_config.json" > "$agent_dir/.env"

staging="$(mktemp -d)"
uv run --frozen --group deploy adk deploy agent_engine \
  --project "$project" \
  --region "$region" \
  --agent_engine_id "$AGENT_RUNTIME_ID" \
  --display_name "kata-agents" \
  --description "Kata AI Project Manager and AI Strategist." \
  --temp_folder "$staging" \
  --otel_to_cloud \
  "$agent_dir"
