variable "project_id" {
  description = "The GCP project ID that will host the responder Cloud Run services and Artifact Registry repo."
  type        = string
}

variable "image" {
  description = "Fully-qualified Artifact Registry image reference for the responder container, e.g. us-central1-docker.pkg.dev/PROJECT/speedtest/responder:latest."
  type        = string
}

variable "service_name" {
  description = "Base name for the per-region Cloud Run services."
  type        = string
  default     = "speedtest-responder"
}

variable "max_instances" {
  description = "Maximum number of Cloud Run instances per region. Kept low to stay near the free tier."
  type        = number
  default     = 3
}

variable "artifact_region" {
  description = "Single region hosting the Artifact Registry Docker repository and the default provider region."
  type        = string
  default     = "us-central1"
}

variable "artifact_repository_id" {
  description = "Artifact Registry repository ID that stores the responder image."
  type        = string
  default     = "speedtest"
}

variable "regions" {
  description = "GCP regions to deploy the responder to. Trim this list to reduce cost/footprint."
  type        = list(string)
  default = [
    "africa-south1",
    "asia-east1",
    "asia-east2",
    "asia-northeast1",
    "asia-northeast2",
    "asia-northeast3",
    "asia-south1",
    "asia-south2",
    "asia-southeast1",
    "asia-southeast2",
    "australia-southeast1",
    "australia-southeast2",
    "europe-central2",
    "europe-north1",
    "europe-southwest1",
    "europe-west1",
    "europe-west2",
    "europe-west3",
    "europe-west4",
    "europe-west6",
    "europe-west8",
    "europe-west9",
    "europe-west10",
    "europe-west12",
    "me-central1",
    "me-central2",
    "me-west1",
    "northamerica-northeast1",
    "northamerica-northeast2",
    "northamerica-south1",
    "southamerica-east1",
    "southamerica-west1",
    "us-central1",
    "us-east1",
    "us-east4",
    "us-east5",
    "us-south1",
    "us-west1",
    "us-west2",
    "us-west3",
    "us-west4",
  ]
}
