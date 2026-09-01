import { TestBed } from '@angular/core/testing'
import { Title } from '@angular/platform-browser'
import { describe, expect, it } from 'vitest'

import { PrivacyComponent } from './privacy.component'

describe('PrivacyComponent', () => {
  it('mounts and sets SEO metadata on init', () => {
    TestBed.configureTestingModule({ imports: [PrivacyComponent] })
    const fixture = TestBed.createComponent(PrivacyComponent)
    fixture.detectChanges()
    expect(TestBed.inject(Title).getTitle()).toContain('Privacy Policy')
    expect(fixture.nativeElement.textContent).toContain('compatible browser agent')
    expect(fixture.nativeElement.textContent).toContain('source IP address')
    expect(fixture.nativeElement.textContent).toContain('not uploaded')
  })
})
