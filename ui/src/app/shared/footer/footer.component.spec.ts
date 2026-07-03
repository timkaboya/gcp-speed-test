import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { beforeEach, describe, expect, it } from 'vitest'

import { FooterComponent } from './footer.component'

describe('FooterComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FooterComponent],
      providers: [provideRouter([])]
    })
  })

  it('mounts and exposes the start year', () => {
    const fixture = TestBed.createComponent(FooterComponent)
    fixture.detectChanges()
    expect(fixture.componentInstance.startYear).toBe(2013)
    expect(fixture.nativeElement).toBeTruthy()
  })
})
