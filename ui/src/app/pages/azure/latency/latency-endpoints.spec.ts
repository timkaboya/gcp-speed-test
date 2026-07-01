import { describe, expect, it } from 'vitest'

import { RegionService } from '../../../services/region.service'

/**
 * Regression guard for GitHub issue #197.
 *
 * The Azure latency test pings each active region's blob endpoint. The endpoint
 * URL is built from the synthetic `storageAccountName` that `RegionService`
 * assigns to every non-restricted region (see `region.service.ts` — prefix
 * `s3`/`s8`/`q9` cycled by region order + `regionId`).
 *
 * This test exercises the REAL generation logic in `RegionService` and asserts
 * that every generated endpoint actually resolves with HTTP 200, mirroring the
 * `HEAD` request issued by `LatencyComponent.pingRegion()`. If a region is
 * reordered/added/removed and the positional prefix scheme points an account at
 * a non-existent storage account, this test fails and names the broken region.
 *
 * Source of truth for the URL shape:
 *   latency.component.ts ->
 *     `https://${storageAccountName}.blob.core.windows.net/public/latency-test.json`
 */
const buildLatencyEndpoint = (storageAccountName: string): string =>
  `https://${storageAccountName}.blob.core.windows.net/public/latency-test.json`

const HEAD_TIMEOUT_MS = 15000
const SUITE_TIMEOUT_MS = 120000

const regions = new RegionService().getAllRegions()

describe('Azure latency endpoints', () => {
  it('assigns a well-formed storage account name to every active region', () => {
    expect(regions.length).toBeGreaterThan(0)
    for (const region of regions) {
      expect(region.storageAccountName, `region ${region.regionId}`).toMatch(
        /^(s3|s8|q9)[a-z0-9]+$/
      )
    }

    // Storage account names must be globally unique - a positional prefix
    // collision would silently make two regions ping the same endpoint.
    const accountNames = regions.map((region) => region.storageAccountName)
    expect(new Set(accountNames).size).toBe(accountNames.length)
  })

  it(
    'resolves every active region endpoint (HEAD 200)',
    async () => {
      const checks = await Promise.all(
        regions.map(async (region) => {
          const url = `${buildLatencyEndpoint(region.storageAccountName)}?_=${Date.now()}`
          try {
            const response = await fetch(url, {
              method: 'HEAD',
              cache: 'no-cache',
              signal: AbortSignal.timeout(HEAD_TIMEOUT_MS)
            })
            return { region: region.regionId, ok: response.ok, status: response.status }
          } catch (error) {
            return {
              region: region.regionId,
              ok: false,
              status: 0,
              error: (error as Error).message
            }
          }
        })
      )

      const failures = checks.filter((check) => !check.ok || check.status !== 200)
      expect(
        failures,
        `Unresolved endpoints:\n${failures
          .map((f) => `  - ${f.region}: status=${f.status}${f.error ? ` (${f.error})` : ''}`)
          .join('\n')}`
      ).toEqual([])

      expect(checks.length).toBe(regions.length)
    },
    SUITE_TIMEOUT_MS
  )
})
