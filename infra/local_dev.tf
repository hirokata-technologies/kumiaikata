# Identity for running kumiai on a developer machine against the real agents.
#
# No key is created. Developers listed in `local_dev_members` impersonate this
# service account through application default credentials:
#
#   gcloud auth application-default login --impersonate-service-account=<local_dev_service_account>
resource "google_service_account" "kumiai_local" {
  account_id   = "kumiai-local"
  display_name = "Kumiai local development"
  description  = "Impersonated by developers to run kumiai locally against Agent Runtime."

  depends_on = [google_project_service.enabled]
}

resource "google_project_iam_member" "kumiai_local" {
  for_each = toset([
    "roles/aiplatform.user", # Query the agents and manage their sessions
  ])

  project = var.project_id
  role    = each.value
  member  = google_service_account.kumiai_local.member
}

resource "google_service_account_iam_member" "kumiai_local_impersonation" {
  for_each = toset(var.local_dev_members)

  service_account_id = google_service_account.kumiai_local.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = each.value
}
