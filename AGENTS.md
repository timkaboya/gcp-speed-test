# AGENTS.md

Guidance for AI coding agents working in this repository. Keep it current when
conventions or commands change.

## What this project is

`gcp-speed-test` measures network latency from the browser to Google Cloud
regions. It is a **backendless Angular app** inspired by azure-speed-test and
aws-speed-test. The UI pings a small HTTP endpoint in each GCP region and times
the round trip with the browser `Performance` API. Live demo:
[www.gcpspeed.com](https://www.gcpspeed.com).

Key architectural fact: **GCP has no per-region public storage endpoint**
(Cloud Storage is a global anycast behind the Google Front End). The only
reliable way to measure per-region latency is a tiny HTTP responder deployed to
each region, pinged via its region-pinned Cloud Run URL. The default build reuses
gcping's public endpoints (no CORS → pinged with `fetch(url, { mode: 'no-cors' })`,
opaque responses). The production upgrade path is deploying our own `responder/`
which returns permissive CORS + `Timing-Allow-Origin` so the browser can read
real status codes and resource timings.

## Repository layout

| Path         | What it is                                                       |
| ------------ | ---------------------------------------------------------------- |
| `ui/`        | Angular app (the speed-test UI). Backendless. Most work is here. |
| `responder/` | Dependency-free Go HTTP responder, deployed one-per-region.      |
| `infra/`     | Terraform: Artifact Registry repo + per-region Cloud Run.        |
| `.github/`   | CI (build/test UI) and a manual deploy workflow.                 |
| `docs/`      | Public integration contracts and implementation notes.           |

## Commands

All UI commands run from `ui/`:

```bash
npm install
npm start          # dev server at http://localhost:4200
npm run build      # production build (SSR/prerender, static output)
npm test           # unit tests (Vitest via @angular/build:unit-test)
npm run test:ci    # tests with coverage + enforced thresholds
npm run lint       # eslint (angular-eslint)
npm run format     # prettier --write
npm run format:check
node scripts/generate-endpoints.mjs   # regenerate src/assets/data/endpoints.json
```

Responder (from `responder/`): standard Go 1.22 module, no dependencies.
`go build ./...`, `go test ./...`. Container via `Dockerfile`; listens on `$PORT`
(default 8080), reports `$REGION`.

Infra (from repo root): `terraform -chdir=infra init|apply|destroy`. Requires
`-var project_id=...` and `-var image=...`. See README "Phase 0" for the full
deploy flow.

## Conventions

- **Angular 22, standalone + signals.** Use `signal`/`computed`, `@Injectable({ providedIn: 'root' })`, `loadComponent`/`loadChildren` lazy routes. No NgModules.
- **TypeScript/JS style (Prettier, enforced):** no semicolons, single quotes, 2-space indent, `printWidth` 100, `trailingComma: none`, always-parens arrows. Imports are auto-sorted by `@ianvs/prettier-plugin-sort-imports`.
- **SSR/prerender aware:** region data is baked into the bundle and loaded synchronously to avoid layout shift during prerender; browser-only work (the actual ping) must be guarded where it runs. Keep this in mind for anything touching startup or `RegionService`.
- **Tests are mandatory.** Every module has a `*.spec.ts`. `npm run test:ci` enforces coverage thresholds defined in `ui/angular.json` (`test > configurations > ci > coverageThresholds`: statements/branches/functions 60, lines 65). Add/adjust tests for every change; do not drop coverage below thresholds.
- **WebMCP lifecycle:** Site tools are registered once from `app.config.ts` through the browser-only `GcpLatencyWebMcpService`. Keep handlers thin: validate untrusted arguments, call `RegionService`/`LatencyTestStore`, return bounded results, and unregister through the shared abort signal. Never expose endpoint URLs, connection metadata, cookies, or payment data. Keep `WEBMCP_ENABLED` as the single emergency kill switch.
- **Responder:** keep it dependency-free (stdlib only). Every response sets the common CORS + `Cache-Control: no-store` + `Timing-Allow-Origin` headers via `setCommonHeaders`.

## Workflow / review rules

- **`main` is protected — no direct pushes.** Every change goes through a PR from a feature branch.
- **All changes require code-owner review** (`@timkaboya`, `.github/CODEOWNERS`) and must pass CI (`.github/workflows/ci.yml`: lint → `test:ci` → build).
- Commits must be signed off (`git commit -s`); merges use **squash merge**.
- See `CONTRIBUTING.md` and `SECURITY.md` for the full security-first workflow.

## Gotchas

- The default endpoint list depends on gcping's public endpoints — no CORS, no SLA. `endpoints.json` is generated at build time and cannot be fetched at runtime in the browser.
- `no-cors` responses are opaque: you can time them but cannot read status/timing. Real status + timing require our own responders (CORS + `Timing-Allow-Origin`).
- `package.json` still carries some Azure-derived names (e.g. the `serve:ssr:azure-speed-test` script, `azure-speed-test` project key in `angular.json`) — the app is GCP, these are legacy names.
- WebMCP is a draft API. CI uses a fake `ModelContext`; before rollout, also inspect all four tools in Chrome with `chrome://flags/#enable-webmcp-testing`, then exercise them in the supported ChatGPT desktop browser. See `docs/webmcp.md`.
