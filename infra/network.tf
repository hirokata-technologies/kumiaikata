# Private network for Cloud SQL.
#
# The organization blocks public IPs on Cloud SQL (sql.restrictPublicIp), so
# the database only has a private IP on this network, reached through Private
# Service Access. Cloud Run joins the network with Direct VPC egress. None of
# this has a running cost.

resource "google_compute_network" "kumiai" {
  name                    = "kumiai"
  auto_create_subnetworks = false

  depends_on = [google_project_service.enabled]
}

# Cloud Run instances take their IPs from this subnet (Direct VPC egress).
resource "google_compute_subnetwork" "kumiai" {
  name                     = "kumiai"
  region                   = var.region
  network                  = google_compute_network.kumiai.id
  ip_cidr_range            = "10.10.0.0/24"
  private_ip_google_access = true
}

# Address range Google uses for Cloud SQL inside the network.
resource "google_compute_global_address" "kumiai_private_services" {
  name          = "kumiai-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.kumiai.id
}

resource "google_service_networking_connection" "kumiai" {
  network                 = google_compute_network.kumiai.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.kumiai_private_services.name]
}
