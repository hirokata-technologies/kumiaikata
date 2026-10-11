# The Agent Runtime instance that hosts both agents.
#
# Terraform owns the instance. The agent code (spec) is deployed by
# `adk deploy agent_engine` from GitHub Actions, so changes to spec are ignored
# here. See apps/agents/README.md.
resource "google_vertex_ai_reasoning_engine" "kata_agents" {
  display_name = "kata-agents"
  description  = "Kata AI Project Manager and AI Strategist."
  region       = var.region

  deletion_policy = "PREVENT"

  lifecycle {
    ignore_changes = [spec]
  }

  depends_on = [google_project_service.enabled]
}
