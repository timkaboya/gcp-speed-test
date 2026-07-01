import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { describe, expect, it } from 'vitest'

import { InformationComponent } from './information.component'

describe('InformationComponent', () => {
  it('mounts with a router outlet', () => {
    TestBed.configureTestingModule({
      imports: [InformationComponent],
      providers: [provideRouter([])]
    })
    const fixture = TestBed.createComponent(InformationComponent)
    fixture.detectChanges()
    expect((fixture.nativeElement as HTMLElement).querySelector('router-outlet')).not.toBeNull()
  })
})
