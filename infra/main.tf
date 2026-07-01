locals {
  # Required Google Cloud APIs for building and running the responders.
  required_apis = [
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
  ]
}

# Enable the APIs the deployment depends on.
resource "google_project_service" "required" {
  for_each = toset(local.required_apis)

  project = var.project_id
  service = each.value

  disable_on_destroy = false
}

# Single-region Artifact Registry Docker repo that holds the responder image.
resource "google_artifact_registry_repository" "responder" {
  project       = var.project_id
  location      = var.artifact_region
  repository_id = var.artifact_repository_id
  description   = "Container images for the gcp-speed-test responder."
  format        = "DOCKER"

  depends_on = [google_project_service.required]
}

# One Cloud Run service per region. Scales to zero to stay near the free tier;
# cold starts are acceptable for a latency probe.
resource "google_cloud_run_v2_service" "responder" {
  for_each = toset(var.regions)

  project             = var.project_id
  name                = "${var.service_name}-${each.value}"
  location            = each.value
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      env {
        name  = "REGION"
        value = each.value
      }

      resources {
        cpu_idle = true
        limits = {
          cpu    = "1"
          memory = "128Mi"
        }
      }
    }
  }

  depends_on = [google_project_service.required]
}

# Make every responder publicly invokable so the browser can ping it.
resource "google_cloud_run_v2_service_iam_member" "public" {
  for_each = google_cloud_run_v2_service.responder

  project  = each.value.project
  location = each.value.location
  name     = each.value.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
