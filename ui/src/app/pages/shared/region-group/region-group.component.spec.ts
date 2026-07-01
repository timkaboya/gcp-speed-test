import { ComponentFixture, TestBed } from '@angular/core/testing'
import { beforeEach, describe, expect, it } from 'vitest'

import { RegionGroup, RegionService } from '../../../services'
import { RegionGroupComponent } from './region-group.component'

describe('RegionGroupComponent', () => {
  let fixture: ComponentFixture<RegionGroupComponent>
  let component: RegionGroupComponent
  let regionService: RegionService

  // Region data is now bundled and loaded synchronously, so tests derive their
  // subjects from the real region groups rather than a mocked HTTP response.
  function multiRegionGroup(): RegionGroup {
    return component.regionGroups().find((g) => g.regions.length > 1)!
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [RegionGroupComponent] })
    regionService = TestBed.inject(RegionService)
    fixture = TestBed.createComponent(RegionGroupComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('exposes total region count from the bundled data', () => {
    expect(component.totalRegionCount()).toBe(regionService.regions().length)
    expect(component.totalRegionCount()).toBeGreaterThan(0)
    expect(component.selectedRegionCount()).toBe(0)
  })

  it('toggles a single region on and off', () => {
    const group = component.regionGroups()[0]
    const region = group.regions[0]

    component.onChange(region, group)
    expect(component.isRegionChecked(region.regionId)).toBe(true)
    expect(component.selectedRegionCount()).toBe(1)

    component.onChange(region, group)
    expect(component.isRegionChecked(region.regionId)).toBe(false)
    expect(component.selectedRegionCount()).toBe(0)
  })

  it('marks a group indeterminate when partially selected', () => {
    const group = multiRegionGroup()
    component.onChange(group.regions[0], group)
    expect(component.isGroupIndeterminate(group)).toBe(true)
    expect(component.isGroupChecked(group)).toBe(false)
  })

  it('selects and deselects a whole group via the group checkbox', () => {
    const group = multiRegionGroup()

    component.onChange(null, group)
    expect(component.isGroupChecked(group)).toBe(true)
    expect(component.isGroupIndeterminate(group)).toBe(false)
    expect(component.selectedRegionCount()).toBe(group.regions.length)

    component.onChange(null, group)
    expect(component.isGroupChecked(group)).toBe(false)
    expect(component.selectedRegionCount()).toBe(0)
  })

  it('clears the whole selection', () => {
    const group = multiRegionGroup()
    component.onChange(null, group)
    expect(component.selectedRegionCount()).toBe(group.regions.length)

    component.clearSelection()
    expect(component.selectedRegionCount()).toBe(0)
    expect(regionService.selectedRegions()).toEqual([])
  })

  it('clearSelection is a no-op when nothing is selected', () => {
    component.clearSelection()
    expect(component.selectedRegionCount()).toBe(0)
  })

  it('ignores onChange with a falsy group', () => {
    const region = component.regionGroups()[0].regions[0]
    component.onChange(region, null as unknown as RegionGroup)
    expect(component.selectedRegionCount()).toBe(0)
  })

  it('provides stable trackBy keys', () => {
    const group = component.regionGroups()[0]
    const region = group.regions[0]
    expect(component.trackByGroup(0, group)).toBe(group.regionGroup)
    expect(component.trackByRegion(0, region)).toBe(region.regionId)
  })
})
