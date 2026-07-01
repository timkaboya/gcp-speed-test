import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { describe, expect, it } from 'vitest'

import { GcpComponent } from './gcp.component'

describe('GcpComponent', () => {
  it('mounts with a router outlet', () => {
    TestBed.configureTestingModule({
      imports: [GcpComponent],
      providers: [provideRouter([])]
    })
    const fixture = TestBed.createComponent(GcpComponent)
    fixture.detectChanges()
    expect((fixture.nativeElement as HTMLElement).querySelector('router-outlet')).not.toBeNull()
  })
})
