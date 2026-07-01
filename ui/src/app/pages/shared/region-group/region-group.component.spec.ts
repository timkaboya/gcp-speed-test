import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { PLATFORM_ID } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { beforeEach, describe, expect, it } from 'vitest'

import { RegionModel } from '../../../models'
import { RegionGroup, RegionService } from '../../../services'
import { RegionGroupComponent } from './region-group.component'

const REGIONS: RegionModel[] = [
  { regionId: 'us-east1', displayName: 'South Carolina', geography: 'Americas', url: 'https://a' },
  { regionId: 'us-west1', displayName: 'Oregon', geography: 'Americas', url: 'https://b' },
  { regionId: 'europe-west1', displayName: 'Belgium', geography: 'Europe', url: 'https://c' }
]

describe('RegionGroupComponent', () => {
  let fixture: ComponentFixture<RegionGroupComponent>
  let component: RegionGroupComponent
  let regionService: RegionService

  function groupByName(name: string): RegionGroup {
    return component.regionGroups().find((g) => g.regionGroup === name)!
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RegionGroupComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: 'browser' }
      ]
    })
    regionService = TestBed.inject(RegionService)
    TestBed.inject(HttpTestingController).expectOne('assets/data/endpoints.json').flush(REGIONS)

    fixture = TestBed.createComponent(RegionGroupComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('exposes total region count', () => {
    expect(component.totalRegionCount()).toBe(3)
    expect(component.selectedRegionCount()).toBe(0)
  })

  it('toggles a single region on and off', () => {
    const americas = groupByName('Americas')
    component.onChange(REGIONS[0], americas)
    expect(component.isRegionChecked('us-east1')).toBe(true)
    expect(component.selectedRegionCount()).toBe(1)

    component.onChange(REGIONS[0], americas)
    expect(component.isRegionChecked('us-east1')).toBe(false)
    expect(component.selectedRegionCount()).toBe(0)
  })

  it('marks a group indeterminate when partially selected', () => {
    const americas = groupByName('Americas')
    component.onChange(REGIONS[0], americas)
    expect(component.isGroupIndeterminate(americas)).toBe(true)
    expect(component.isGroupChecked(americas)).toBe(false)
  })

  it('selects and deselects a whole group via the group checkbox', () => {
    const americas = groupByName('Americas')
    component.onChange(null, americas)
    expect(component.isGroupChecked(americas)).toBe(true)
    expect(component.isGroupIndeterminate(americas)).toBe(false)
    expect(component.selectedRegionCount()).toBe(2)

    component.onChange(null, americas)
    expect(component.isGroupChecked(americas)).toBe(false)
    expect(component.selectedRegionCount()).toBe(0)
  })

  it('clears the whole selection', () => {
    component.onChange(null, groupByName('Americas'))
    expect(component.selectedRegionCount()).toBe(2)
    component.clearSelection()
    expect(component.selectedRegionCount()).toBe(0)
    expect(regionService.selectedRegions()).toEqual([])
  })

  it('clearSelection is a no-op when nothing is selected', () => {
    component.clearSelection()
    expect(component.selectedRegionCount()).toBe(0)
  })

  it('ignores onChange with a falsy group', () => {
    component.onChange(REGIONS[0], null as unknown as RegionGroup)
    expect(component.selectedRegionCount()).toBe(0)
  })

  it('provides stable trackBy keys', () => {
    const group = groupByName('Europe')
    expect(component.trackByGroup(0, group)).toBe('Europe')
    expect(component.trackByRegion(0, REGIONS[2])).toBe('europe-west1')
  })
})
