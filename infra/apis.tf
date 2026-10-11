locals {
  services = [
    "aiplatform.googleapis.com",       # Agent Runtime, sessions, Memory Bank, Gemini
    "artifactregistry.googleapis.com", # Agent Runtime image builds
    "cloudbuild.googleapis.com",       # Agent Runtime image builds
    "cloudresourcemanager.googleapis.com",
    "certificatemanager.googleapis.com", # HTTPS certificate for the web load balancer
    "cloudtrace.googleapis.com",
    "compute.googleapis.com", # Web load balancer
    "iam.googleapis.com",
    "iamcredentials.googleapis.com", # Short-lived tokens for Workload Identity Federation
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com", # Web app
    "secretmanager.googleapis.com",
    "sqladmin.googleapis.com",          # Cloud SQL (Postgres)
    "servicenetworking.googleapis.com", # Private IP for Cloud SQL
    "sts.googleapis.com",               # Workload Identity Federation token exchange
    "telemetry.googleapis.com",
  ]
}

resource "google_project_service" "enabled" {
  for_each = toset(local.services)

  service            = each.value
  disable_on_destroy = false
}
