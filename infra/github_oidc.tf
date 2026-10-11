# Lets GitHub Actions deploy without a stored service account key.
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"

  depends_on = [google_project_service.enabled]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions OIDC"

  # The repository uses GitHub's immutable OIDC subject
  # (repo:OWNER@OWNER_ID/REPO@REPO_ID:ref:...), so access is granted on mapped
  # attributes built from the immutable IDs instead of on the subject format.
  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
    "attribute.repo_ref"   = "assertion.repository_id + \"@\" + assertion.ref"
  }

  # Only this repository, identified by its immutable owner and repository IDs,
  # can exchange tokens at all.
  attribute_condition = "assertion.repository_owner_id == \"${var.github_owner_id}\" && assertion.repository_id == \"${var.github_repository_id}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

locals {
  # Workflows of this repository running on the deploy ref.
  github_deploy_principal = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repo_ref/${var.github_repository_id}@${var.github_deploy_ref}"
}

# Only workflows running on the deploy ref may act as the deployer.
resource "google_service_account_iam_member" "github_deploys" {
  service_account_id = google_service_account.agents_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.github_deploy_principal
}
