#!/usr/bin/env pwsh
# Reads `terraform output -json` from infra/ and writes
# ui/src/assets/data/endpoints.json in the shape the UI expects:
#   [{ "regionId", "displayName", "geography", "url" }]
#
# Requirements: terraform
# Usage (from repo root):
#   ./infra/write-endpoints.ps1
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$out = Join-Path $repoRoot 'ui/src/assets/data/endpoints.json'

# regionId -> human-friendly city/display name. Regions not listed here fall
# back to the region ID; the UI's generate-endpoints.mjs can further enrich.
$displayNames = @{
  'africa-south1'           = 'Johannesburg'
  'asia-east1'              = 'Taiwan'
  'asia-east2'              = 'Hong Kong'
  'asia-northeast1'         = 'Tokyo'
  'asia-northeast2'         = 'Osaka'
  'asia-northeast3'         = 'Seoul'
  'asia-south1'             = 'Mumbai'
  'asia-south2'             = 'Delhi'
  'asia-southeast1'         = 'Singapore'
  'asia-southeast2'         = 'Jakarta'
  'australia-southeast1'    = 'Sydney'
  'australia-southeast2'    = 'Melbourne'
  'europe-central2'         = 'Warsaw'
  'europe-north1'           = 'Finland'
  'europe-southwest1'       = 'Madrid'
  'europe-west1'            = 'Belgium'
  'europe-west2'            = 'London'
  'europe-west3'            = 'Frankfurt'
  'europe-west4'            = 'Netherlands'
  'europe-west6'            = 'Zurich'
  'europe-west8'            = 'Milan'
  'europe-west9'            = 'Paris'
  'europe-west10'           = 'Berlin'
  'europe-west12'           = 'Turin'
  'me-central1'             = 'Doha'
  'me-central2'             = 'Dammam'
  'me-west1'                = 'Tel Aviv'
  'northamerica-northeast1' = 'Montreal'
  'northamerica-northeast2' = 'Toronto'
  'northamerica-south1'     = 'Mexico'
  'southamerica-east1'      = 'Sao Paulo'
  'southamerica-west1'      = 'Santiago'
  'us-central1'             = 'Iowa'
  'us-east1'                = 'South Carolina'
  'us-east4'                = 'Northern Virginia'
  'us-east5'                = 'Columbus'
  'us-south1'               = 'Dallas'
  'us-west1'                = 'Oregon'
  'us-west2'                = 'Los Angeles'
  'us-west3'                = 'Salt Lake City'
  'us-west4'                = 'Las Vegas'
}

function Get-Geography([string]$region) {
  switch ($region.Split('-')[0]) {
    'africa' { 'Africa' }
    'asia' { 'Asia Pacific' }
    'australia' { 'Asia Pacific' }
    'europe' { 'Europe' }
    'me' { 'Middle East' }
    'northamerica' { 'North America' }
    'southamerica' { 'South America' }
    'us' { 'North America' }
    default { 'Other' }
  }
}

$json = terraform -chdir="$repoRoot/infra" output -json endpoints
$map = $json | ConvertFrom-Json

$endpoints = foreach ($prop in $map.PSObject.Properties) {
  $regionId = $prop.Name
  [pscustomobject]@{
    regionId    = $regionId
    displayName = if ($displayNames.ContainsKey($regionId)) { $displayNames[$regionId] } else { $regionId }
    geography   = Get-Geography $regionId
    url         = ($prop.Value -replace '/$', '')
  }
}

$endpoints = $endpoints | Sort-Object regionId
($endpoints | ConvertTo-Json -Depth 5) + "`n" | Set-Content -NoNewline -Path $out
Write-Output "Wrote $($endpoints.Count) endpoints to $out"
