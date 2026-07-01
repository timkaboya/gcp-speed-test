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

  it('sets Open Graph and Twitter social tags', () => {
    const meta = TestBed.inject(Meta)
    service.setSocialTags(
      'Card Title',
      'Card description',
      'https://example.com/x',
      'https://img/y.png'
    )

    expect(meta.getTag('property="og:title"')?.content).toBe('Card Title')
    expect(meta.getTag('property="og:description"')?.content).toBe('Card description')
    expect(meta.getTag('property="og:url"')?.content).toBe('https://example.com/x')
    expect(meta.getTag('property="og:image"')?.content).toBe('https://img/y.png')
    expect(meta.getTag('property="og:type"')?.content).toBe('website')
    expect(meta.getTag('name="twitter:card"')?.content).toBe('summary_large_image')
    expect(meta.getTag('name="twitter:title"')?.content).toBe('Card Title')
    expect(meta.getTag('name="twitter:image"')?.content).toBe('https://img/y.png')
  })

  it('applyPageSeo sets title, description, canonical and social tags for a path', () => {
    const meta = TestBed.inject(Meta)
    service.applyPageSeo({
      title: 'Page Title',
      description: 'Page description',
      path: '/Gcp/Latency'
    })

    expect(TestBed.inject(Title).getTitle()).toBe('Page Title')
    expect(meta.getTag('name="description"')?.content).toBe('Page description')
    const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    expect(canonical?.getAttribute('href')).toBe('https://www.gcpspeed.com/Gcp/Latency')
    expect(meta.getTag('property="og:url"')?.content).toBe('https://www.gcpspeed.com/Gcp/Latency')
    expect(meta.getTag('property="og:image"')?.content).toBe(
      'https://www.gcpspeed.com/og-image.png'
    )
  })

  it('applyPageSeo honours a custom social image', () => {
    const meta = TestBed.inject(Meta)
    service.applyPageSeo({
      title: 'T',
      description: 'D',
      path: '/Privacy',
      image: 'https://img/custom.png'
    })

    expect(meta.getTag('property="og:image"')?.content).toBe('https://img/custom.png')
  })
})
