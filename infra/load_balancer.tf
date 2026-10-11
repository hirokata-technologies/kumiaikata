# Global external Application Load Balancer in front of the web app.
#
# Cloudflare proxies var.kumiai_domain to the static IP below. The HTTPS
# certificate comes from Certificate Manager with DNS authorization, so it is
# issued and renewed through a CNAME record and works behind the Cloudflare
# proxy. See infra/README.md for the DNS records.

resource "google_compute_global_address" "kumiai" {
  name = "kumiai"

  depends_on = [google_project_service.enabled]
}

resource "google_compute_region_network_endpoint_group" "kumiai" {
  name                  = "kumiai"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.kumiai.name
  }
}

resource "google_compute_backend_service" "kumiai" {
  name                  = "kumiai"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"

  backend {
    group = google_compute_region_network_endpoint_group.kumiai.id
  }

  log_config {
    enable      = true
    sample_rate = 1
  }
}

resource "google_compute_url_map" "kumiai" {
  name            = "kumiai"
  default_service = google_compute_backend_service.kumiai.id
}

# HTTPS certificate

resource "google_certificate_manager_dns_authorization" "kumiai" {
  name   = "kumiai"
  domain = var.kumiai_domain

  depends_on = [google_project_service.enabled]
}

resource "google_certificate_manager_certificate" "kumiai" {
  name = "kumiai"

  managed {
    domains            = [var.kumiai_domain]
    dns_authorizations = [google_certificate_manager_dns_authorization.kumiai.id]
  }
}

resource "google_certificate_manager_certificate_map" "kumiai" {
  name = "kumiai"

  depends_on = [google_project_service.enabled]
}

resource "google_certificate_manager_certificate_map_entry" "kumiai" {
  name         = "kumiai"
  map          = google_certificate_manager_certificate_map.kumiai.name
  hostname     = var.kumiai_domain
  certificates = [google_certificate_manager_certificate.kumiai.id]
}

# HTTPS (443)

resource "google_compute_target_https_proxy" "kumiai" {
  name            = "kumiai"
  url_map         = google_compute_url_map.kumiai.id
  certificate_map = "//certificatemanager.googleapis.com/${google_certificate_manager_certificate_map.kumiai.id}"
}

resource "google_compute_global_forwarding_rule" "kumiai_https" {
  name                  = "kumiai-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.kumiai.id
  port_range            = "443"
  target                = google_compute_target_https_proxy.kumiai.id
}

# HTTP (80) redirects to HTTPS

resource "google_compute_url_map" "kumiai_http_redirect" {
  name = "kumiai-http-redirect"

  default_url_redirect {
    https_redirect         = true
    strip_query            = false
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
  }
}

resource "google_compute_target_http_proxy" "kumiai_http_redirect" {
  name    = "kumiai-http-redirect"
  url_map = google_compute_url_map.kumiai_http_redirect.id
}

resource "google_compute_global_forwarding_rule" "kumiai_http" {
  name                  = "kumiai-http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.kumiai.id
  port_range            = "80"
  target                = google_compute_target_http_proxy.kumiai_http_redirect.id
}
