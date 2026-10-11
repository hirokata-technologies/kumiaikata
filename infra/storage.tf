# Card attachments. The app writes with its runtime service account, so no
# access keys are needed.
resource "google_storage_bucket" "kumiai_attachments" {
  name     = "${var.project_id}-kumiai-attachments"
  location = var.region

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  depends_on = [google_project_service.enabled]
}

resource "google_storage_bucket_iam_member" "kumiai_runtime_attachments" {
  bucket = google_storage_bucket.kumiai_attachments.name
  role   = "roles/storage.objectAdmin"
  member = google_service_account.kumiai_runtime.member
}
