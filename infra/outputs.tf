output "endpoints" {
  description = "Map of region ID to the public Cloud Run service URL for that region's responder."
  value = {
    for region, svc in google_cloud_run_v2_service.responder : region => svc.uri
  }
}

output "artifact_repository" {
  description = "Full path of the Artifact Registry repository holding the responder image."
  value       = "${var.artifact_region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.responder.repository_id}"
}
