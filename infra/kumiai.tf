# The kumiai app (apps/web: SvelteKit with the API merged in) on Cloud Run,
# reachable only through the load balancer in load_balancer.tf, plus the Cloud
# Run Job that runs database migrations with the same image.
#
# Terraform owns the service, the job and their settings. GitHub Actions
# (.github/workflows/deploy-kumiai.yml) ships new images, so the image is ignored
# here. The first apply starts Google's placeholder image until CI deploys.

locals {
  kumiai_origin = "https://${var.kumiai_domain}"

  kumiai_env = {
    NODE_ENV          = "production"
    ORIGIN            = local.kumiai_origin
    BETTER_AUTH_URL   = local.kumiai_origin
    ALLOWED_ORIGINS   = local.kumiai_origin
    ALLOWED_DOMAINS   = join(",", var.kumiai_allowed_domains)
    GCS_BUCKET        = google_storage_bucket.kumiai_attachments.name
    PUBLIC_SENTRY_DSN = var.kumiai_sentry_dsn
    # Agent Runtime instance that hosts the Project Manager and Strategist.
    AGENT_RUNTIME_NAME = google_vertex_ai_reasoning_engine.kata_agents.id
  }

  # Command the migration job runs inside the app image.
  kumiai_migrate_command = ["node", "migrate.js"]
}

resource "google_artifact_registry_repository" "kata" {
  repository_id = "kata"
  location      = var.region
  format        = "DOCKER"
  description   = "Kata container images."

  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }

  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "2592000s" # 30 days
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_service_account" "kumiai_runtime" {
  account_id   = "kumiai-runtime"
  display_name = "Kumiai runtime"
  description  = "Runs the kumiai app and its migration job on Cloud Run."

  depends_on = [google_project_service.enabled]
}

resource "google_project_iam_member" "kumiai_runtime" {
  for_each = toset([
    "roles/aiplatform.user", # Query the agents and manage their sessions
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ])

  project = var.project_id
  role    = each.value
  member  = google_service_account.kumiai_runtime.member
}

resource "google_cloud_run_v2_service" "kumiai" {
  name     = "kumiai"
  location = var.region

  # Only the load balancer can reach the service; the run.app URL is closed.
  ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  # The organization blocks granting access to allUsers, so the invoker check
  # is turned off instead. The app handles its own login.
  invoker_iam_disabled = true
  deletion_protection  = true

  # Service-level limits across all revisions receiving traffic. The revision-level
  # limits below only cover one revision, so these keep a split rollout at one too.
  scaling {
    min_instance_count = 1
    max_instance_count = 1
  }

  template {
    service_account = google_service_account.kumiai_runtime.email
    # Live board updates hold a request open, so allow many per instance.
    max_instance_request_concurrency = 200
    # Long enough for live board update streams (server-sent events).
    timeout = "3600s"

    scaling {
      # Keep one instance warm: no cold starts, and the in-process event bus stays up.
      min_instance_count = 1
      # One instance: live updates use an in-process event bus (no Redis).
      max_instance_count = 1
    }

    # Reach Cloud SQL's private IP (Direct VPC egress).
    vpc_access {
      network_interfaces {
        network    = google_compute_network.kumiai.id
        subnetwork = google_compute_subnetwork.kumiai.id
      }
      egress = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = false # Instance-based billing: CPU is allocated (and billed) for the whole instance lifetime
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = local.kumiai_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.kumiai[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    # CI deploys new images with gcloud, which also sets these client fields.
    ignore_changes = [
      client,
      client_version,
      template[0].containers[0].image,
    ]
  }

  depends_on = [
    google_project_iam_member.kumiai_runtime,
    google_secret_manager_secret_iam_member.kumiai_runtime_reads,
    google_secret_manager_secret_version.kumiai_generated,
    google_secret_manager_secret_version.kumiai_external_placeholder,
  ]
}

# Runs database migrations. CI updates its image and executes it before each
# deploy of the service.
resource "google_cloud_run_v2_job" "kumiai_migrate" {
  name     = "kumiai-migrate"
  location = var.region

  deletion_protection = true

  template {
    task_count = 1

    template {
      service_account = google_service_account.kumiai_runtime.email
      max_retries     = 0
      timeout         = "600s"

      vpc_access {
        network_interfaces {
          network    = google_compute_network.kumiai.id
          subnetwork = google_compute_subnetwork.kumiai.id
        }
        egress = "PRIVATE_RANGES_ONLY"
      }

      containers {
        image   = "us-docker.pkg.dev/cloudrun/container/hello"
        command = local.kumiai_migrate_command

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.kumiai["database-url"].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      client,
      client_version,
      template[0].template[0].containers[0].image,
    ]
  }

  depends_on = [
    google_project_iam_member.kumiai_runtime,
    google_secret_manager_secret_iam_member.kumiai_runtime_reads,
    google_secret_manager_secret_version.kumiai_generated,
  ]
}

# Identity GitHub Actions uses to push web images and deploy them.
resource "google_service_account" "kumiai_deployer" {
  account_id   = "kumiai-deployer"
  display_name = "Kumiai deployer"
  description  = "Used by GitHub Actions to push images, run migrations and deploy the kumiai app."

  depends_on = [google_project_service.enabled]
}

resource "google_project_iam_member" "kumiai_deployer_uses_services" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageConsumer"
  member  = google_service_account.kumiai_deployer.member
}

resource "google_artifact_registry_repository_iam_member" "kumiai_deployer_pushes" {
  location   = google_artifact_registry_repository.kata.location
  repository = google_artifact_registry_repository.kata.name
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.kumiai_deployer.member
}

resource "google_cloud_run_v2_service_iam_member" "kumiai_deployer_deploys" {
  location = google_cloud_run_v2_service.kumiai.location
  name     = google_cloud_run_v2_service.kumiai.name
  role     = "roles/run.developer"
  member   = google_service_account.kumiai_deployer.member
}

resource "google_cloud_run_v2_job_iam_member" "kumiai_deployer_migrates" {
  location = google_cloud_run_v2_job.kumiai_migrate.location
  name     = google_cloud_run_v2_job.kumiai_migrate.name
  role     = "roles/run.developer"
  member   = google_service_account.kumiai_deployer.member
}

resource "google_service_account_iam_member" "kumiai_deployer_acts_as_runtime" {
  service_account_id = google_service_account.kumiai_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.kumiai_deployer.member
}

resource "google_service_account_iam_member" "github_deploys_kumiai" {
  service_account_id = google_service_account.kumiai_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.github_deploy_principal
}
