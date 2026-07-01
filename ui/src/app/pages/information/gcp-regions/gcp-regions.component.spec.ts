import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { PLATFORM_ID } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { Title } from '@angular/platform-browser'
import { provideRouter } from '@angular/router'
import { describe, expect, it } from 'vitest'

import { RegionModel } from '../../../models'
import { GcpRegionsComponent } from './gcp-regions.component'

const REGIONS: RegionModel[] = [
  { regionId: 'us-east1', displayName: 'South Carolina', geography: 'Americas', url: 'https://a' },
  { regionId: 'europe-west1', displayName: 'Belgium', geography: 'Europe', url: 'https://b' }
]

describe('GcpRegionsComponent', () => {
  it('mounts, sets SEO metadata and exposes the region count', () => {
    TestBed.configureTestingModule({
      imports: [GcpRegionsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'browser' }
      ]
    })
    const fixture = TestBed.createComponent(GcpRegionsComponent)
    TestBed.inject(HttpTestingController).expectOne('assets/data/endpoints.json').flush(REGIONS)
    fixture.detectChanges()

    expect(TestBed.inject(Title).getTitle()).toContain('Google Cloud Regions')
    expect(fixture.componentInstance.totalRegionCount()).toBe(2)
    expect(fixture.componentInstance.regionGroups().length).toBe(2)
  })
})
