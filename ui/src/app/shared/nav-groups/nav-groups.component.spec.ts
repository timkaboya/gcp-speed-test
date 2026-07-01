import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { beforeEach, describe, expect, it } from 'vitest'

import { NavGroup, NavGroupsComponent } from './nav-groups.component'

const GROUPS: NavGroup[] = [
  {
    heading: 'Testing',
    items: [{ label: 'Latency', icon: 'zap', routerLink: '/Gcp/Latency' }]
  },
  {
    items: [{ label: 'Regions', icon: 'globe-2', routerLink: '/Information/GcpRegions' }]
  }
]

describe('NavGroupsComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NavGroupsComponent],
      providers: [provideRouter([])]
    })
  })

  it('defaults groups to an empty array', () => {
    const fixture = TestBed.createComponent(NavGroupsComponent)
    fixture.detectChanges()
    expect(fixture.componentInstance.groups()).toEqual([])
  })

  it('renders provided groups and items', () => {
    const fixture = TestBed.createComponent(NavGroupsComponent)
    fixture.componentRef.setInput('navGroups', GROUPS)
    fixture.detectChanges()
    const text = (fixture.nativeElement as HTMLElement).textContent ?? ''
    expect(text).toContain('Latency')
    expect(text).toContain('Regions')
  })

  it('produces stable trackBy keys with and without a heading', () => {
    const fixture = TestBed.createComponent(NavGroupsComponent)
    const component = fixture.componentInstance
    expect(component.navGroupTrackBy(0, GROUPS[0])).toBe('Testing')
    expect(component.navGroupTrackBy(1, GROUPS[1])).toBe('group-1')
    expect(component.navItemTrackBy(0, GROUPS[0].items[0])).toBe('/Gcp/Latency')
  })

  it('emits navigate only when dismissOnNavigate is enabled', () => {
    const fixture = TestBed.createComponent(NavGroupsComponent)
    const component = fixture.componentInstance
    let emitted = 0
    component.navigate.subscribe(() => (emitted += 1))

    component.handleNavLinkClick()
    expect(emitted).toBe(0)

    fixture.componentRef.setInput('dismissOnNavigate', true)
    component.handleNavLinkClick()
    expect(emitted).toBe(1)
  })
})
