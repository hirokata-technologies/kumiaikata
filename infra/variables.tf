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
  description = "Email domains allowed to sign in. Use [\"*\"] to open sign-up to every domain."
  type        = list(string)

  validation {
    condition = length(var.kumiai_allowed_domains) > 0 && alltrue([
      for d in var.kumiai_allowed_domains : d == "*" || can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", d))
    ])
    error_message = "Each entry must be \"*\" or a lower-case email domain such as hirokata.dev, and the list must not be empty."
  }
}

variable "local_dev_members" {
  description = "IAM members (for example user:name@hirokata.dev) allowed to impersonate the local development service account."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for m in var.local_dev_members : can(regex("^(user|group):[^@\\s]+@[^@\\s]+$", m))])
    error_message = "Each entry must look like user:name@hirokata.dev or group:team@hirokata.dev."
  }
}

variable "kumiai_sentry_dsn" {
  description = "Sentry DSN (the Sentry project is still named kata-web). Empty disables Sentry."
  type        = string
  default     = ""
}
