import { isPlatformBrowser } from '@angular/common'
import { HttpClient } from '@angular/common/http'
import { computed, inject, Injectable, PLATFORM_ID, Signal, signal } from '@angular/core'

import { RegionModel } from '../models'

export interface RegionGroup {
  regionGroup: string
  regions: RegionModel[]
}

@Injectable({
  providedIn: 'root'
})
export class RegionService {
  private readonly http = inject(HttpClient)
  private readonly platformId = inject(PLATFORM_ID)
  private readonly isBrowser = isPlatformBrowser(this.platformId)
  private readonly regionCollator = new Intl.Collator('en', { sensitivity: 'base' })

  private readonly regionsState = signal<RegionModel[]>([])
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

  constructor() {
    // Endpoints have no CORS, so we load the pre-generated list same-origin via
    // HttpClient rather than hitting the gcping API at runtime. Only the browser
    // needs the data (the ping test is browser-only); the server renders a shell.
    if (this.isBrowser) {
      this.http.get<RegionModel[]>('assets/data/endpoints.json').subscribe({
        next: (regions) => this.regionsState.set(Array.isArray(regions) ? regions : []),
        error: () => this.regionsState.set([])
      })
    }
  }

  updateSelectedRegions(regions: RegionModel[]): void {
    this.selectedRegionsState.set(regions)
  }
}
