output "agent_runtime_id" {
  description = "Agent Runtime instance ID. Set as the AGENT_RUNTIME_ID GitHub Actions variable."
  value       = google_vertex_ai_reasoning_engine.kata_agents.name
}

output "agent_runtime_name" {
  description = "Full Agent Runtime resource name."
  value       = google_vertex_ai_reasoning_engine.kata_agents.id
}

output "runtime_service_account" {
  description = "Service account the agents run as."
  value       = google_service_account.agents_runtime.email
}

output "deployer_service_account" {
  description = "Service account GitHub Actions deploys as. Set as the GCP_DEPLOYER_SERVICE_ACCOUNT GitHub Actions variable."
  value       = google_service_account.agents_deployer.email
}

output "caller_service_account" {
  description = "Service account the Kata API uses to call the agents."
  value       = google_service_account.agents_caller.email
}

output "workload_identity_provider" {
  description = "Workload Identity provider for GitHub Actions. Set as the GCP_WORKLOAD_IDENTITY_PROVIDER GitHub Actions variable."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "kumiai_ip_address" {
  description = "Load balancer IP. Point the Cloudflare A record for kumiai_domain here (proxied)."
  value       = google_compute_global_address.kumiai.address
}

output "kumiai_certificate_dns_record" {
  description = "CNAME record Certificate Manager needs to issue and renew the HTTPS certificate. Add it in Cloudflare as DNS only."
  value = {
    name = google_certificate_manager_dns_authorization.kumiai.dns_resource_record[0].name
    type = google_certificate_manager_dns_authorization.kumiai.dns_resource_record[0].type
    data = google_certificate_manager_dns_authorization.kumiai.dns_resource_record[0].data
  }
}

output "kumiai_image_repository" {
  description = "Artifact Registry path for web images. Set as the KUMIAI_IMAGE_REPOSITORY GitHub Actions variable."
  value       = "${google_artifact_registry_repository.kata.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.kata.repository_id}"
}

output "kumiai_deployer_service_account" {
  description = "Service account GitHub Actions deploys the web app as. Set as the GCP_KUMIAI_DEPLOYER_SERVICE_ACCOUNT GitHub Actions variable."
  value       = google_service_account.kumiai_deployer.email
}
