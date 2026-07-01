import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { PLATFORM_ID } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { beforeEach, describe, expect, it } from 'vitest'

import { RegionModel } from '../models'
import { RegionService } from './region.service'

const REGIONS: RegionModel[] = [
  { regionId: 'us-east1', displayName: 'South Carolina', geography: 'Americas', url: 'https://a' },
  { regionId: 'us-west1', displayName: 'Oregon', geography: 'Americas', url: 'https://b' },
  { regionId: 'europe-west1', displayName: 'Belgium', geography: 'Europe', url: 'https://c' }
]

function setup(platform: string): { service: RegionService; http: HttpTestingController } {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: PLATFORM_ID, useValue: platform }
    ]
  })
  const service = TestBed.inject(RegionService)
  const http = TestBed.inject(HttpTestingController)
  return { service, http }
}

describe('RegionService (browser)', () => {
  let service: RegionService
  let http: HttpTestingController

  beforeEach(() => {
    ;({ service, http } = setup('browser'))
  })

  it('loads endpoints.json and populates the regions signal', () => {
    const req = http.expectOne('assets/data/endpoints.json')
    expect(req.request.method).toBe('GET')
    req.flush(REGIONS)

    expect(service.regions()).toHaveLength(3)
    http.verify()
  })

  it('falls back to an empty list when the response is not an array', () => {
    http.expectOne('assets/data/endpoints.json').flush({ not: 'an array' })
    expect(service.regions()).toEqual([])
  })

  it('falls back to an empty list on error', () => {
    http.expectOne('assets/data/endpoints.json').error(new ProgressEvent('error'))
    expect(service.regions()).toEqual([])
  })

  it('groups regions by geography, sorted by displayName and group size', () => {
    http.expectOne('assets/data/endpoints.json').flush(REGIONS)

    const groups = service.regionGroups()
    expect(groups).toHaveLength(2)
    // Americas has 2 regions so it sorts before Europe (1 region).
    expect(groups[0].regionGroup).toBe('Americas')
    expect(groups[0].regions.map((r) => r.displayName)).toEqual(['Oregon', 'South Carolina'])
    expect(groups[1].regionGroup).toBe('Europe')
  })

  it('skips regions without a geography when grouping', () => {
    http
      .expectOne('assets/data/endpoints.json')
      .flush([
        ...REGIONS,
        { regionId: 'x', displayName: 'No Geo', geography: '', url: 'https://d' }
      ])
    const groups = service.regionGroups()
    const allRegions = groups.flatMap((g) => g.regions)
    expect(allRegions.some((r) => r.regionId === 'x')).toBe(false)
  })

  it('updateSelectedRegions updates the selectedRegions signal', () => {
    http.expectOne('assets/data/endpoints.json').flush(REGIONS)
    expect(service.selectedRegions()).toEqual([])
    service.updateSelectedRegions([REGIONS[0]])
    expect(service.selectedRegions()).toEqual([REGIONS[0]])
  })
})

describe('RegionService (server)', () => {
  it('does not issue an HTTP request when not in the browser', () => {
    const { service, http } = setup('server')
    http.verify()
    expect(service.regions()).toEqual([])
  })
})
