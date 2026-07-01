import { DOCUMENT } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { Meta, Title } from '@angular/platform-browser'
import { beforeEach, describe, expect, it } from 'vitest'

import { SeoService } from './seo.service'

describe('SeoService', () => {
  let service: SeoService
  let document: Document

  beforeEach(() => {
    TestBed.configureTestingModule({})
    service = TestBed.inject(SeoService)
    document = TestBed.inject(DOCUMENT)
    document.head.querySelectorAll('link[rel="canonical"]').forEach((link) => link.remove())
  })

  it('sets the page title', () => {
    service.setMetaTitle('My Title')
    expect(TestBed.inject(Title).getTitle()).toBe('My Title')
  })

  it('sets the meta description', () => {
    service.setMetaDescription('A description')
    const tag = TestBed.inject(Meta).getTag('name="description"')
    expect(tag?.content).toBe('A description')
  })

  it('creates a canonical link when none exists', () => {
    service.setCanonicalUrl('https://example.com/page')
    const link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    expect(link?.getAttribute('href')).toBe('https://example.com/page')
  })

  it('updates the existing canonical link instead of adding another', () => {
    service.setCanonicalUrl('https://example.com/one')
    service.setCanonicalUrl('https://example.com/two')

    const links = document.head.querySelectorAll('link[rel="canonical"]')
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('https://example.com/two')
  })
})
