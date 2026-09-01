# WebMCP Site tools

GCP Speed Test exposes four imperative WebMCP Site tools so a compatible
in-page browser agent can discover regions, run the existing browser latency
test, read ranked results, and stop a run without DOM scraping.

WebMCP is a progressive enhancement. Unsupported browsers use the normal site,
and server rendering never touches the browser API.

## Architecture

The latency measurement must execute in the visitor's browser. A conventional
remote MCP server would measure its own server-to-GCP route and answer a
different question.

`GcpLatencyWebMcpService` feature-detects
`document.modelContext.registerTool()` and registers the tools once during the
top-level Angular application lifecycle. Its handlers validate arguments and
delegate to the same `RegionService` and `LatencyTestStore` used by the visible
UI. The service does not duplicate network or ranking logic.

`start_gcp_latency_test` returns immediately after reserving the run, navigating
within the SPA to `/`, and atomically committing it. Agents poll
`get_gcp_latency_results`; the background run continues until it completes,
reaches its deadline, is stopped, or the person changes the page state.

## Tool contract

All input schemas reject additional properties. Runtime validation is the trust
boundary; the JSON schemas are also published to help agents form valid calls.
Inputs are limited to 4,096 UTF-8 bytes and outputs to 1,536 UTF-8 bytes.

### `list_gcp_regions`

Read-only region discovery.

| Input       | Type              | Rules                                                  |
| ----------- | ----------------- | ------------------------------------------------------ |
| `geography` | string, optional  | One current geography name.                            |
| `query`     | string, optional  | Case-insensitive ID/name match; at most 64 characters. |
| `offset`    | integer, optional | At least 0; default 0.                                 |
| `limit`     | integer, optional | 1-20; default 20.                                      |

Returns `total`, `returned`, `nextOffset`, and compact `regions` containing only
`id`, `name`, and `geography`.

### `start_gcp_latency_test`

Starts a visible, bounded, browser-originated test.

| Input           | Type     | Rules                                                     |
| --------------- | -------- | --------------------------------------------------------- |
| `scope`         | string   | Required: `all`, `geographies`, `regions`, or `selected`. |
| `regionIds`     | string[] | Required only for `regions`; 1-44 unique catalog IDs.     |
| `geographies`   | string[] | Required only for `geographies`; unique known values.     |
| `sampleTarget`  | integer  | Optional, 1-5; default 3.                                 |
| `replaceActive` | boolean  | Optional; default false.                                  |

Success returns a generated run ID, selected count, target sample count,
recommended polling interval, and the name of the results tool. A run ID matches
`^gcp-[a-z0-9]{12}$`.

### `get_gcp_latency_results`

Read-only polling for the latest or specified Site tool run.

| Input      | Type              | Rules                                             |
| ---------- | ----------------- | ------------------------------------------------- |
| `runId`    | string, optional  | Defaults to the latest retained Site tool run.    |
| `revision` | integer, optional | Pins later pages; requires the matching `runId`. |
| `offset`   | integer, optional | At least 0; default 0.                            |
| `limit`    | integer, optional | 1-10; default 10.                                 |

Results are globally ranked by ascending true median latency. Each row contains
only `rank`, region `id`, `name`, `medianMs`, `latestMs`, and `samples`.
`nextOffset` is an integer or `null`. If samples change during pagination, the
caller receives `STALE_SNAPSHOT` and should request offset 0 without a revision.
Terminal snapshots remain queryable for five minutes or until a newer Site tool
run starts.

### `stop_gcp_latency_test`

Stops only the matching Site tool run. It is idempotent while the matching
terminal snapshot is retained and leaves partial results visible.

| Input   | Type   | Rules                      |
| ------- | ------ | -------------------------- |
| `runId` | string | Required Site tool run ID. |

## States and errors

Run states are `starting`, `running`, `completed`, `partial`, `cancelled`, and
`failed`. Errors use:

```json
{ "ok": false, "error": { "code": "INVALID_INPUT", "message": "..." } }
```

Stable codes are `INVALID_INPUT`, `UNKNOWN_REGION`, `NO_SELECTION`, `BUSY`,
`COOLDOWN`, `NO_RUN`, `RUN_NOT_FOUND`, `STALE_SNAPSHOT`,
`NAVIGATION_FAILED`, and `UNAVAILABLE`.

## Operational and privacy limits

- One active run is allowed per page.
- A shared semaphore allows at most four browser requests in flight.
- Each request has a five-second timeout; an abort-settlement grace prevents a
  nonconforming fetch from leaking a semaphore permit.
- A tool run records at most five samples per region and attempts at most
  `sampleTarget + 3` requests per region, including warm-up/retries.
- The all-region request budget is at most 352 requests.
- Runs stop after 120 seconds and new agent starts have a 15-second cooldown.
- Browser requests remain `HEAD`, `mode: "no-cors"`, and `cache: "no-store"`.
- Starting a test sends requests from the visitor's browser to regional endpoint
  operators. Those operators receive normal network metadata such as the source
  IP. Measurements remain in page memory and are not uploaded by this
  integration.
- Tool outputs never include endpoint URLs, IP addresses, Cloudflare connection
  details, cookies, authentication data, or payment data.
- Tools are same-origin only; registration does not use `exposedTo`.

The static host sends `Origin-Agent-Cluster: ?1` and a
`Permissions-Policy` containing `tools=(self)`. COOP and COEP are intentionally
not enabled solely for WebMCP because they are unnecessary here and could
disrupt third-party integrations.

## Compatibility and validation

OpenAI Site tools currently run in the latest ChatGPT desktop built-in browser
with GPT-5.6 Sol or Terra, subject to rollout and workspace availability. The
ChatGPT browser currently discovers imperative tools on the top-level page, not
declarative form tools or iframe registrations.

Chrome's implementation is available for local testing with
`chrome://flags/#enable-webmcp-testing` and its Model Context Tool Inspector.
WebMCP remains a draft, so compatibility must be reconfirmed before rollout.

Automated validation from `ui/`:

```bash
npm run lint
npm run test:ci
npm run build
```

Manual release gate:

1. Inspect all four schemas and annotations in Chrome's Model Context Tool
   Inspector.
2. Start, poll, paginate, stop, cancel during navigation, and verify the visible
   `aria-live` status.
3. Use the actual ChatGPT desktop built-in browser with GPT-5.6 Sol or Terra to
   discover and invoke all four tools before merging.
4. After deployment, verify both headers on `/` and a navigation-fallback route
   and confirm `window.originAgentCluster === true` in a newly opened window.

## Rollback

Set `WEBMCP_ENABLED` to `false` for an emergency registration kill switch. A
full rollback removes the initializer/service and WebMCP-specific headers. The
shared latency store and normal human workflow continue to operate without a
data migration.

## Decision and implementation log

### 2026-09-01 - Research and approved design

- Reviewed OpenAI Site tools, the WebMCP draft specification, Chrome's
  imperative/security guidance, and Angular's experimental integration.
- Chose imperative top-level Site tools because they are the currently supported
  discovery path in the ChatGPT browser.
- Chose asynchronous start/get/stop operations to keep calls short and outputs
  bounded while measurements continue visibly in the page.
- Chose native registration with pinned `webmcp-types@0.1.5` so annotations are
  preserved without requiring a framework upgrade.
- Excluded CSV, connection metadata, payments, endpoint URLs, iframe exposure,
  and remote measurement from v1.

### 2026-09-01 - Shared latency engine, PR #45

- Extracted the component's scheduler and measurement state into
  `LatencyTestStore`.
- Added atomic ownership, cancellation, deadlines, request budgets, retry
  backoff, cooldown, a global four-request semaphore, and bounded tool runs.
- Corrected the previous small-sample calculation to a true median and removed
  overlapping sweeps.
- Added engine/component coverage and opened
  [PR #45](https://github.com/timkaboya/gcp-speed-test/pull/45) at commit
  `20c53ab`.

### 2026-09-01 - Site tools implementation

- Added the four imperative tools, strict schemas and runtime validators,
  navigation-safe reservations, compact revision-pinned result pagination,
  five-minute terminal snapshots, and a visible `aria-live` run status.
- An independent defect review added an explicit routed-view activation
  handshake, ensured selection-suppression tokens cannot outlive their intended
  update, and required revisions to be paired with a run ID so pages cannot be
  mixed across runs.
- Added same-origin hosting headers, crawler guidance, privacy disclosure, the
  emergency kill switch, fake-ModelContext unit tests, and SSR guards.
- Implementation branch: `timkaboya/webmcp-site-tools`, stacked on PR #45.
- Automated gate: lint passed; 154 tests passed; coverage reached 81.59%
  statements, 80.18% branches, 86.98% functions, and 82.75% lines; the
  production build prerendered all six routes with Angular 22.0.4.
- The Chrome Model Context Tool Inspector and actual ChatGPT desktop invocation
  remain required manual pre-merge gates.
