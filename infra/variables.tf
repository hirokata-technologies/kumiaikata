variable "project_id" {
  description = "Google Cloud project that hosts the Kata agents."
  type        = string
}

variable "region" {
  description = "Region for Agent Runtime and regional resources."
  type        = string
}

variable "github_repository" {
  description = "GitHub repository (owner/name) allowed to deploy through Workload Identity Federation."
  type        = string
}

variable "github_owner_id" {
  description = "Immutable numeric ID of the GitHub repository owner."
  type        = string
}

variable "github_repository_id" {
  description = "Immutable numeric ID of the GitHub repository."
  type        = string
}

variable "github_deploy_ref" {
  description = "Git ref allowed to deploy. Only workflows running on this ref can impersonate the deployer."
  type        = string
  default     = "refs/heads/main"
}

variable "kumiai_domain" {
  description = "Public hostname of the web app, served by the Google load balancer."
  type        = string
}

variable "kumiai_allowed_domains" {
  description = "Email domains allowed to sign in. Only hirokata.dev is permitted."
  type        = list(string)

  validation {
    condition     = alltrue([for d in var.kumiai_allowed_domains : d == "hirokata.dev"])
    error_message = "Only hirokata.dev is allowed."
  }
}

variable "kumiai_sentry_dsn" {
  description = "Sentry DSN (the Sentry project is still named kata-web). Empty disables Sentry."
  type        = string
  default     = ""
}
