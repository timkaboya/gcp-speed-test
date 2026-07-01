# gcp-speed-test

Measure network latency from your browser to Google Cloud regions worldwide — a
backendless Angular app inspired by [azure-speed-test][azure] and
[aws-speed-test][aws].

**Live demo:** _coming soon_ (placeholder — deploy the `ui/` app to your host of
choice).

## What it does

`gcp-speed-test` runs entirely in the browser. It pings a small HTTP endpoint in
each Google Cloud region and measures the round-trip time with the
`Performance` API, giving you a live view of which regions are closest to you.

## Architecture

### Why per-region responders?

Azure and AWS expose **per-region storage endpoints** (Azure Blob Storage,
Amazon S3) that you can ping directly to measure regional latency. **Google
Cloud does not.** Cloud Storage is served from a single global anycast hostname
fronted by the Google Front End (GFE), so pinging it only measures the distance
to your nearest GFE POP — not to a specific region.

The only reliable way to measure per-region latency on GCP is to deploy a tiny
HTTP responder to each region and ping its **region-pinned URL**. This is the
same model used by Google's open-source [`gcping`][gcping].

### The CORS / `no-cors` finding

The free MVP reuses gcping's public Cloud Run endpoints (baked into
`ui/src/assets/data/endpoints.json`). Those endpoints **do not send CORS
headers**, so the browser can only ping them with `fetch(url, { mode: 'no-cors' })`.
In `no-cors` mode the response is *opaque*: we can time it, but we cannot read
the status code or resource-timing details.

The production upgrade path in this repo is **our own per-region Cloud Run
responder** (`responder/`) that returns:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`
- `Access-Control-Allow-Headers: *`
- `Cache-Control: no-store`
- `Timing-Allow-Origin: *`

With CORS + `Timing-Allow-Origin`, the browser can read real status codes and
detailed resource timings, and the app can later add download throughput tests
(via the responder's `/size` endpoint) — all without depending on gcping.

### Repository layout

| Path         | What it is                                                        |
| ------------ | ----------------------------------------------------------------- |
| `ui/`        | Angular app (the speed test UI). Backendless.                     |
| `responder/` | Dependency-free Go HTTP responder deployed one-per-region.        |
| `infra/`     | Terraform to build the image repo and deploy responders to GCP.   |
| `.github/`   | CI (build/test UI) and a manual deploy workflow.                  |

## Run locally

```bash
cd ui
npm install
npm start          # dev server at http://localhost:4200
```

Other UI commands:

```bash
cd ui
npm run build      # production build
npm test           # unit tests
npm run lint       # lint
```

## Regenerate endpoints data

The default endpoint list is generated from gcping's public endpoints:

```bash
cd ui
node scripts/generate-endpoints.mjs
```

This writes `ui/src/assets/data/endpoints.json`. gcping's endpoints have no
CORS, so this list is baked in at build time (it cannot be fetched at runtime in
the browser) and the region URLs are pinged with `no-cors`.

## Phase 0 — Deploy your own responders (optional, for production)

The default build pings **gcping's** public endpoints. They have no CORS and no
SLA. To get real status/timing (and remove the gcping dependency), deploy your
own responders. These steps are optimized to cost **≈ $0** by using Cloud Run
with `min-instances=0` (scale to zero, cold starts acceptable) within the
[always-free tier][freetier].

> Run everything below under the Google account **`timothy.kaboya@gmail.com`**.

### 1. Install the tools

- [Google Cloud CLI (`gcloud`)][gcloud]
- [Terraform][terraform] (>= 1.5)
- [Docker][docker] (only if you build the image locally instead of Cloud Build)

### 2. Authenticate and create a fresh project

```bash
gcloud auth login                     # sign in as timothy.kaboya@gmail.com
gcloud auth application-default login # credentials for Terraform

PROJECT_ID="gcp-speed-test-$(date +%s)"   # must be globally unique
gcloud projects create "$PROJECT_ID"
gcloud config set project "$PROJECT_ID"

# Link a billing account (required even for the free tier). List yours:
gcloud billing accounts list
gcloud billing projects link "$PROJECT_ID" --billing-account=XXXXXX-XXXXXX-XXXXXX
```

### 3. Enable APIs and create the image repo

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com

REGION=us-central1
REPO=speedtest
gcloud artifacts repositories create "$REPO" \
  --location="$REGION" --repository-format=docker
```

### 4. Build & push the responder image

Using Cloud Build (no local Docker needed):

```bash
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/responder:latest"
gcloud builds submit responder --tag "$IMAGE"
```

…or with local Docker:

```bash
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/responder:latest"
gcloud auth configure-docker "$REGION-docker.pkg.dev"
docker build -t "$IMAGE" responder
docker push "$IMAGE"
```

### 5. Deploy the per-region responders with Terraform

```bash
terraform -chdir=infra init
terraform -chdir=infra apply \
  -var "project_id=$PROJECT_ID" \
  -var "image=$IMAGE"
```

By default this deploys to ~40 regions. Trim the `regions` variable (see
`infra/variables.tf`) to deploy fewer, e.g.:

```bash
terraform -chdir=infra apply \
  -var "project_id=$PROJECT_ID" \
  -var "image=$IMAGE" \
  -var 'regions=["us-central1","europe-west1","asia-southeast1"]'
```

### 6. Point the UI at your responders

Regenerate `ui/src/assets/data/endpoints.json` from your Terraform outputs:

```bash
# macOS/Linux (needs jq):
./infra/write-endpoints.sh

# Windows / PowerShell:
./infra/write-endpoints.ps1
```

Then rebuild and redeploy the UI:

```bash
cd ui
npm install
npm run build
# deploy ui/dist/** to your static host
```

### Cost note

Cloud Run's [free tier][freetier] includes a monthly allotment of requests,
CPU-seconds and memory-seconds. With `min-instances=0` the responders scale to
zero when idle, so an idle deployment costs **≈ $0**; you only pay if traffic
exceeds the free tier. Artifact Registry storage for one small image is
negligible. You can destroy everything with:

```bash
terraform -chdir=infra destroy -var "project_id=$PROJECT_ID" -var "image=$IMAGE"
```

> **Note:** The default build depends on gcping's public endpoints. gcping is
> **not an official Google product** and comes with **no SLA**. Deploying your
> own responders (above) removes that dependency.

## Acknowledgements

- [azure-speed-test][azure] by @blrchen — the original inspiration.
- [aws-speed-test][aws] by @blrchen — the AWS sibling.
- [gcping][gcping] by Google Cloud Platform — the per-region responder model and
  default public endpoints.

## License

[MIT](LICENSE) © 2026 Timothy Kaboya

[azure]: https://github.com/blrchen/azure-speed-test
[aws]: https://github.com/blrchen/aws-speed-test
[gcping]: https://github.com/GoogleCloudPlatform/gcping
[gcloud]: https://cloud.google.com/sdk/docs/install
[terraform]: https://developer.hashicorp.com/terraform/install
[docker]: https://docs.docker.com/get-docker/
[freetier]: https://cloud.google.com/free
