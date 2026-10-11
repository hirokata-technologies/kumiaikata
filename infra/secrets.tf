# Secrets for the kumiai app.
#
# - DATABASE_URL and BETTER_AUTH_SECRET are generated here. Their values live
#   in Terraform state, which is on the private RustFS server.
# - The Google OAuth client and the Resend API key come from outside, so
#   Terraform only creates the secret with a placeholder. Add the real value by
#   hand (see infra/README.md); it never enters Terraform state.

locals {
  generated_secrets = {
    # sslmode=require with libpq semantics: encrypted, without verifying the
    # server certificate (the connection never leaves the private network).
    database-url       = "postgresql://${google_sql_user.kumiai.name}:${random_password.kumiai_db.result}@${google_sql_database_instance.kumiai.private_ip_address}:5432/${google_sql_database.kumiai.name}?uselibpqcompat=true&sslmode=require"
    better-auth-secret = random_password.better_auth.result
  }

  external_secrets = toset([
    "google-client-id",
    "google-client-secret",
    "resend-api-key",
  ])

  # Environment variable name → secret id suffix.
  secret_env = {
    DATABASE_URL         = "database-url"
    BETTER_AUTH_SECRET   = "better-auth-secret"
    GOOGLE_CLIENT_ID     = "google-client-id"
    GOOGLE_CLIENT_SECRET = "google-client-secret"
    RESEND_API_KEY       = "resend-api-key"
  }
}

resource "random_password" "better_auth" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "kumiai" {
  for_each = toset(concat(keys(local.generated_secrets), tolist(local.external_secrets)))

  secret_id = "kumiai-${each.value}"

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_version" "kumiai_generated" {
  for_each = local.generated_secrets

  secret      = google_secret_manager_secret.kumiai[each.key].id
  secret_data = each.value
}

resource "google_secret_manager_secret_version" "kumiai_external_placeholder" {
  for_each = local.external_secrets

  secret      = google_secret_manager_secret.kumiai[each.value].id
  secret_data = "replace-me"

  lifecycle {
    ignore_changes = [secret_data, enabled]
  }
}

resource "google_secret_manager_secret_iam_member" "kumiai_runtime_reads" {
  for_each = google_secret_manager_secret.kumiai

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.kumiai_runtime.member
}
