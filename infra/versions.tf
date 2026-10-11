terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state on the private RustFS server (S3-compatible), shared with the
  # other hirokata.dev stacks under its own key. Credentials are not stored
  # here: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in the environment.
  backend "s3" {
    bucket = "hirokata-cloudflare-tf-state"
    key    = "kumiaikata/terraform.tfstate"
    region = "us-east-1" # required by the backend; RustFS ignores it

    endpoints      = { s3 = "https://s3.apps.hirokata.dev" }
    use_path_style = true
    use_lockfile   = true # lock object at <key>.tflock, no DynamoDB

    # The endpoint is not AWS: skip AWS-only checks.
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
