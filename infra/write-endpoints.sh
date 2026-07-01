#!/usr/bin/env bash
# Reads `terraform output -json` from infra/ and writes
# ui/src/assets/data/endpoints.json in the shape the UI expects:
#   [{ "regionId", "displayName", "geography", "url" }]
#
# Requirements: terraform, jq
# Usage (from repo root):
#   ./infra/write-endpoints.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="$REPO_ROOT/ui/src/assets/data/endpoints.json"

# regionId -> human-friendly city/display name. Regions not listed here fall
# back to the region ID; the UI's generate-endpoints.mjs can further enrich.
read -r -d '' DISPLAY_NAMES <<'JSON' || true
{
  "africa-south1": "Johannesburg",
  "asia-east1": "Taiwan",
  "asia-east2": "Hong Kong",
  "asia-northeast1": "Tokyo",
  "asia-northeast2": "Osaka",
  "asia-northeast3": "Seoul",
  "asia-south1": "Mumbai",
  "asia-south2": "Delhi",
  "asia-southeast1": "Singapore",
  "asia-southeast2": "Jakarta",
  "australia-southeast1": "Sydney",
  "australia-southeast2": "Melbourne",
  "europe-central2": "Warsaw",
  "europe-north1": "Finland",
  "europe-southwest1": "Madrid",
  "europe-west1": "Belgium",
  "europe-west2": "London",
  "europe-west3": "Frankfurt",
  "europe-west4": "Netherlands",
  "europe-west6": "Zurich",
  "europe-west8": "Milan",
  "europe-west9": "Paris",
  "europe-west10": "Berlin",
  "europe-west12": "Turin",
  "me-central1": "Doha",
  "me-central2": "Dammam",
  "me-west1": "Tel Aviv",
  "northamerica-northeast1": "Montreal",
  "northamerica-northeast2": "Toronto",
  "northamerica-south1": "Mexico",
  "southamerica-east1": "Sao Paulo",
  "southamerica-west1": "Santiago",
  "us-central1": "Iowa",
  "us-east1": "South Carolina",
  "us-east4": "Northern Virginia",
  "us-east5": "Columbus",
  "us-south1": "Dallas",
  "us-west1": "Oregon",
  "us-west2": "Los Angeles",
  "us-west3": "Salt Lake City",
  "us-west4": "Las Vegas"
}
JSON

terraform -chdir="$REPO_ROOT/infra" output -json endpoints \
  | jq --argjson names "$DISPLAY_NAMES" '
      def geography(r):
        (r | split("-")[0]) as $p
        | if   $p == "africa"       then "Africa"
          elif $p == "asia"         then "Asia Pacific"
          elif $p == "australia"    then "Asia Pacific"
          elif $p == "europe"       then "Europe"
          elif $p == "me"           then "Middle East"
          elif $p == "northamerica" then "North America"
          elif $p == "southamerica" then "South America"
          elif $p == "us"           then "North America"
          else "Other" end;
      [ to_entries[]
        | { regionId: .key,
            displayName: ($names[.key] // .key),
            geography: geography(.key),
            url: (.value | sub("/$"; "")) } ]
      | sort_by(.regionId)
    ' > "$OUT"

echo "Wrote $(jq length "$OUT") endpoints to $OUT"
