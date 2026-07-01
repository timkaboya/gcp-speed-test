import { TestBed } from '@angular/core/testing'
import { beforeEach, describe, expect, it } from 'vitest'

import endpointsData from '../../assets/data/endpoints.json'
import { RegionModel } from '../models'
import { RegionService } from './region.service'

const collator = new Intl.Collator('en', { sensitivity: 'base' })

function setup(): RegionService {
  TestBed.configureTestingModule({ providers: [RegionService] })
  return TestBed.inject(RegionService)
}

describe('RegionService', () => {
  let service: RegionService

  beforeEach(() => {
    service = setup()
  })

  it('populates the regions signal synchronously from the bundled endpoint data', () => {
    // Data is imported at build time (no HTTP), so it is available on the very
    // first render — this is what prevents the region-grid layout shift (CLS).
    expect(service.regions().length).toBe(endpointsData.length)
    expect(service.regions().length).toBeGreaterThan(0)
  })

  it('groups regions by geography, sorted by group size then displayName', () => {
    const groups = service.regionGroups()
    expect(groups.length).toBeGreaterThan(0)

    // Groups are ordered by region count, largest first.
    for (let i = 1; i < groups.length; i++) {
      expect(groups[i - 1].regions.length).toBeGreaterThanOrEqual(groups[i].regions.length)
    }

    // Within each group, regions are sorted by displayName (case-insensitive).
    for (const group of groups) {
      const names = group.regions.map((r) => r.displayName)
      const sorted = [...names].sort((a, b) => collator.compare(a, b))
      expect(names).toEqual(sorted)
    }
  })

  it('skips regions without a geography when grouping', () => {
    const grouped = service.regionGroups().flatMap((g) => g.regions)
    expect(grouped.every((r) => r.geography)).toBe(true)
  })

  it('every grouped region carries through the bundled endpoint fields', () => {
    const region: RegionModel = service.regionGroups()[0].regions[0]
    expect(region.regionId).toBeTruthy()
    expect(region.displayName).toBeTruthy()
    expect(region.url).toMatch(/^https:\/\//)
  })

  it('updateSelectedRegions updates the selectedRegions signal', () => {
    expect(service.selectedRegions()).toEqual([])
    const first = service.regions()[0]
    service.updateSelectedRegions([first])
    expect(service.selectedRegions()).toEqual([first])
  })
})
