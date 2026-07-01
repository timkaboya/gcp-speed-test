import { TestBed } from '@angular/core/testing'
import { Title } from '@angular/platform-browser'
import { provideRouter } from '@angular/router'
import { describe, expect, it } from 'vitest'

import { RegionService } from '../../../services'
import { GcpRegionsComponent } from './gcp-regions.component'

describe('GcpRegionsComponent', () => {
  it('mounts, sets SEO metadata and exposes the region count', () => {
    TestBed.configureTestingModule({
      imports: [GcpRegionsComponent],
      providers: [provideRouter([])]
    })
    const fixture = TestBed.createComponent(GcpRegionsComponent)
    fixture.detectChanges()

    const regionService = TestBed.inject(RegionService)
    expect(TestBed.inject(Title).getTitle()).toContain('Google Cloud Regions')
    expect(fixture.componentInstance.totalRegionCount()).toBe(regionService.regions().length)
    expect(fixture.componentInstance.totalRegionCount()).toBeGreaterThan(0)
    expect(fixture.componentInstance.regionGroups().length).toBeGreaterThan(0)
  })
})

