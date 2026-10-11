# Identity the agents run as inside Agent Runtime.
resource "google_service_account" "agents_runtime" {
  account_id   = "kata-agents-runtime"
  display_name = "Kata agents runtime"
  description  = "Runs the Project Manager and Strategist agents in Agent Runtime."

  depends_on = [google_project_service.enabled]
}

resource "google_project_iam_member" "agents_runtime" {
  for_each = toset([
    "roles/aiplatform.user", # Gemini, sessions and Memory Bank
    "roles/cloudtrace.agent",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ])

  project = var.project_id
  role    = each.value
  member  = google_service_account.agents_runtime.member
}

# Identity GitHub Actions uses to deploy new agent code.
resource "google_service_account" "agents_deployer" {
  account_id   = "kata-agents-deployer"
  display_name = "Kata agents deployer"
  description  = "Used by GitHub Actions to deploy agent code to Agent Runtime."

  depends_on = [google_project_service.enabled]
}

resource "google_project_iam_member" "agents_deployer" {
  for_each = toset([
    "roles/aiplatform.user",          # Update the Agent Runtime instance
    "roles/cloudbuild.builds.editor", # Agent Runtime builds the image with Cloud Build
    "roles/serviceusage.serviceUsageConsumer",
  ])

  project = var.project_id
  role    = each.value
  member  = google_service_account.agents_deployer.member
}

# The deployer sets the runtime service account on the agent, so it must be
# allowed to act as it.
resource "google_service_account_iam_member" "deployer_acts_as_runtime" {
  service_account_id = google_service_account.agents_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.agents_deployer.member
}
