import { describe, expect, it } from 'vitest'

import endpoints from '../../../../assets/data/endpoints.json'

/**
 * Guards the shape of the baked-in Google Cloud endpoints list.
 *
 * The latency test pings each region's Cloud Run URL directly from the browser
 * (`no-cors` HEAD request). The endpoint list is generated ahead of time and
 * loaded same-origin via `RegionService`, so this test validates the contract
 * that both the service and `LatencyComponent` depend on: 44 regions, each with
 * a `regionId`, `displayName`, `geography`, and an `https` `url`.
 */
interface EndpointEntry {
  regionId: string
  displayName: string
  geography: string
  url: string
}

const regions = endpoints as EndpointEntry[]

describe('Google Cloud endpoints', () => {
  it('contains the expected number of regions', () => {
    expect(regions.length).toBe(44)
  })

  it('gives every region a well-formed entry', () => {
    for (const region of regions) {
      expect(region.regionId, 'regionId').toBeTruthy()
      expect(typeof region.regionId).toBe('string')
      expect(region.displayName, `displayName for ${region.regionId}`).toBeTruthy()
      expect(region.geography, `geography for ${region.regionId}`).toBeTruthy()
      expect(region.url, `url for ${region.regionId}`).toMatch(/^https:\/\//)
    }
  })

  it('uses unique region ids', () => {
    const ids = regions.map((region) => region.regionId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses unique endpoint urls', () => {
    const urls = regions.map((region) => region.url)
    expect(new Set(urls).size).toBe(urls.length)
  })
})
