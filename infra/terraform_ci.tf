# Identities the Terraform workflow (.github/workflows/terraform.yml) runs as.
#
# - planner: read-only. Pull requests plan with it, so any ref in this repository may use it.
# - applier: changes the project. Only workflows on the deploy ref (main) may use it.
#
# Both use the existing GitHub workload identity pool (github_oidc.tf), so there are no keys.
# These accounts are created by hand the first time (see README, "Terraform in CI"), because
# the workflow needs them to run at all.

resource "google_service_account" "terraform_planner" {
  account_id   = "kumiai-terraform-planner"
  display_name = "Terraform planner"
  description  = "Read-only. Runs terraform plan for pull requests in GitHub Actions."

  depends_on = [google_project_service.enabled]
}

resource "google_service_account" "terraform_applier" {
  account_id   = "kumiai-terraform-applier"
  display_name = "Terraform applier"
  description  = "Runs terraform plan and apply from main in GitHub Actions."

  depends_on = [google_project_service.enabled]
}

resource "google_project_iam_member" "terraform_planner" {
  for_each = toset([
    "roles/viewer",
    "roles/iam.securityReviewer", # Read IAM policies the plan refreshes
    "roles/serviceusage.serviceUsageConsumer",
  ])

  project = var.project_id
  role    = each.value
  member  = google_service_account.terraform_planner.member
}

# One role per area Terraform manages in this directory. roles/resourcemanager.projectIamAdmin
# lets the applier grant itself any role, so in practice it can do anything in the project:
# treat the applier like an owner and keep it limited to main.
resource "google_project_iam_member" "terraform_applier" {
  for_each = toset([
    "roles/run.admin",                       # kumiai.tf: service and migration job
    "roles/cloudsql.admin",                  # database.tf
    "roles/compute.networkAdmin",            # network.tf
    "roles/compute.loadBalancerAdmin",       # load_balancer.tf
    "roles/servicenetworking.networksAdmin", # Private IP for Cloud SQL
    "roles/certificatemanager.editor",       # load_balancer.tf
    "roles/secretmanager.admin",             # secrets.tf
    "roles/storage.admin",                   # storage.tf
    "roles/artifactregistry.admin",          # kumiai.tf
    "roles/aiplatform.admin",                # agent_runtime.tf
    "roles/iam.serviceAccountAdmin",         # service_accounts.tf, kumiai.tf
    "roles/iam.serviceAccountUser",          # Set runtime service accounts on Cloud Run and agents
    "roles/iam.workloadIdentityPoolAdmin",   # github_oidc.tf
    "roles/resourcemanager.projectIamAdmin", # Project role bindings in this directory
    "roles/serviceusage.serviceUsageAdmin",  # apis.tf
  ])

  project = var.project_id
  role    = each.value
  member  = google_service_account.terraform_applier.member
}

# Any workflow of this repository may plan. The provider already rejects other repositories.
resource "google_service_account_iam_member" "github_plans" {
  service_account_id = google_service_account.terraform_planner.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

# Only workflows running on the deploy ref may apply.
resource "google_service_account_iam_member" "github_applies" {
  service_account_id = google_service_account.terraform_applier.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.github_deploy_principal
}
