import { DOCUMENT, inject, Injectable } from '@angular/core'
import { Meta, Title } from '@angular/platform-browser'

import { APP_NAME, SITE_URL, SOCIAL_IMAGE_URL } from '../shared/constants'

export interface PageSeo {
  title: string
  description: string
  /** Route path beginning with '/', e.g. '/Gcp/Latency'. */
  path: string
  image?: string
}

@Injectable({
  providedIn: 'root'
})
export class SeoService {
  private readonly meta = inject(Meta)
  private readonly titleService = inject(Title)
  private readonly document = inject(DOCUMENT)

  /**
   * Apply the full set of SEO tags for a page: title, description, canonical URL
   * and Open Graph / Twitter social cards. Safe to call during prerendering.
   */
  public applyPageSeo(page: PageSeo): void {
    const url = `${SITE_URL}${page.path}`
    this.setMetaTitle(page.title)
    this.setMetaDescription(page.description)
    this.setCanonicalUrl(url)
    this.setSocialTags(page.title, page.description, url, page.image ?? SOCIAL_IMAGE_URL)
  }

  public setMetaTitle(title: string): void {
    this.titleService.setTitle(title)
  }

  public setMetaDescription(content: string): void {
    this.meta.updateTag({
      name: 'description',
      content: content
    })
  }

  public setCanonicalUrl(url: string): void {
    const head = this.document?.head
    if (!head) {
      return
    }

    const existingLink = head.querySelector<HTMLLinkElement>('link[rel="canonical"]')

    if (existingLink) {
      existingLink.setAttribute('href', url)
      return
    }

    const link: HTMLLinkElement = this.document.createElement('link')
    link.setAttribute('rel', 'canonical')
    link.setAttribute('href', url)
    head.appendChild(link)
  }

  public setSocialTags(title: string, description: string, url: string, image: string): void {
    this.meta.updateTag({ property: 'og:type', content: 'website' })
    this.meta.updateTag({ property: 'og:site_name', content: APP_NAME })
    this.meta.updateTag({ property: 'og:title', content: title })
    this.meta.updateTag({ property: 'og:description', content: description })
    this.meta.updateTag({ property: 'og:url', content: url })
    this.meta.updateTag({ property: 'og:image', content: image })
    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' })
    this.meta.updateTag({ name: 'twitter:title', content: title })
    this.meta.updateTag({ name: 'twitter:description', content: description })
    this.meta.updateTag({ name: 'twitter:image', content: image })
  }
}
