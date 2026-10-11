# Cloud SQL for PostgreSQL, the smallest shared-core instance.
#
# Private IP only (the organization blocks public IPs on Cloud SQL). Cloud Run
# reaches it over the network in network.tf; connections are encrypted.

resource "google_sql_database_instance" "kumiai" {
  name             = "kumiai"
  region           = var.region
  database_version = "POSTGRES_18"

  deletion_protection = true

  settings {
    edition           = "ENTERPRISE" # Shared-core tiers need Enterprise edition
    tier              = "db-f1-micro"
    availability_type = "ZONAL"

    disk_type             = "PD_SSD"
    disk_size             = 10
    disk_autoresize       = true
    disk_autoresize_limit = 20

    deletion_protection_enabled = true

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.kumiai.id
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled    = true
      start_time = "18:00" # 02:00 Singapore time

      backup_retention_settings {
        retained_backups = 7
      }
    }

    maintenance_window {
      day  = 7  # Sunday
      hour = 19 # 03:00 Singapore time
    }
  }

  depends_on = [google_service_networking_connection.kumiai]
}

resource "google_sql_database" "kumiai" {
  name     = "kumiai"
  instance = google_sql_database_instance.kumiai.name
}

resource "random_password" "kumiai_db" {
  length  = 32
  special = false
}

resource "google_sql_user" "kumiai" {
  name     = "kumiai"
  instance = google_sql_database_instance.kumiai.name
  password = random_password.kumiai_db.result
}
