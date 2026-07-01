import { computed, Injectable, Signal, signal } from '@angular/core'

import endpointsData from '../../assets/data/endpoints.json'
import { RegionModel } from '../models'

export interface RegionGroup {
  regionGroup: string
  regions: RegionModel[]
}

@Injectable({
  providedIn: 'root'
})
export class RegionService {
  private readonly regionCollator = new Intl.Collator('en', { sensitivity: 'base' })

  // Region data is baked into the bundle (generated `endpoints.json`) and loaded
  // synchronously so the region grid is present during prerender and on the very
  // first client render. Fetching it async caused a large layout shift (CLS) as
  // the empty grid populated after hydration. The ping test itself stays
  // browser-only and is guarded where it runs, not here.
  private readonly regionsState = signal<RegionModel[]>(endpointsData as RegionModel[])
  readonly regions: Signal<RegionModel[]> = this.regionsState.asReadonly()

  private readonly selectedRegionsState = signal<RegionModel[]>([])
  readonly selectedRegions: Signal<RegionModel[]> = this.selectedRegionsState.asReadonly()

  // Google Cloud regions grouped by geography for the region selector.
  readonly regionGroups = computed<RegionGroup[]>(() => {
    const groupsByGeography = new Map<string, RegionModel[]>()

    for (const region of this.regionsState()) {
      const key = region.geography
      if (!key) continue

      const group = groupsByGeography.get(key)
      if (group) {
        group.push(region)
      } else {
        groupsByGeography.set(key, [region])
      }
    }

    const collator = this.regionCollator
    return Array.from(groupsByGeography.entries())
      .map(([regionGroup, regions]) => ({
        regionGroup,
        regions: [...regions].sort((a, b) => collator.compare(a.displayName, b.displayName))
      }))
      .sort((a, b) => b.regions.length - a.regions.length)
  })

  updateSelectedRegions(regions: RegionModel[]): void {
    this.selectedRegionsState.set(regions)
  }
}
