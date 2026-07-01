import { TestBed } from '@angular/core/testing'
import { describe, expect, it } from 'vitest'

import { NotFoundComponent } from './not-found.component'

describe('NotFoundComponent', () => {
  it('mounts and renders the 404 heading', () => {
    TestBed.configureTestingModule({ imports: [NotFoundComponent] })
    const fixture = TestBed.createComponent(NotFoundComponent)
    fixture.detectChanges()
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('404')
  })
})
