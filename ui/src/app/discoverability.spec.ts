import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { SITE_URL } from './shared/constants'

/**
 * Discoverability evals: guard the static assets that make this site legible to
 * search engines and LLM crawlers (Anthropic, OpenAI, Google, Perplexity, etc.).
 *
 * These files ship verbatim from `public/` (robots.txt, llms.txt, sitemap.xml)
 * plus the prerender shell (`src/index.html`). The homepage was moved to `/`, so
 * these checks also protect against regressions where a canonical link silently
 * starts pointing at a redirecting legacy path (`/Gcp/Latency`, `/Gcp`).
 */

// The unit-test runner executes from the `ui/` project root.
const read = (relativeToProjectRoot: string): string =>
  readFileSync(resolve(process.cwd(), relativeToProjectRoot), 'utf8')

const robots = read('public/robots.txt')
const llms = read('public/llms.txt')
const sitemap = read('public/sitemap.xml')
const staticWebAppConfig = JSON.parse(read('public/staticwebapp.config.json')) as {
  globalHeaders?: Record<string, string>
}
const indexHtml = read('src/index.html')

const siteOrigin = new URL(SITE_URL).origin

/** Legacy paths that now 301-redirect to `/`; must never appear as a canonical link. */
const REDIRECTING_PATHS = new Set(['/Gcp', '/Gcp/Latency'])

const normalizePath = (pathname: string): string => pathname.replace(/\/+$/, '') || '/'

/** Parse robots.txt into a map of lowercased user-agent -> its allow/disallow rules. */
const parseRobotsGroups = (text: string): Map<string, string[]> => {
  const groups = new Map<string, string[]>()
  let current: string[] | null = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const separator = line.indexOf(':')
    if (separator === -1) {
      continue
    }
    const field = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (field === 'user-agent') {
      const key = value.toLowerCase()
      current = groups.get(key) ?? []
      groups.set(key, current)
    } else if ((field === 'allow' || field === 'disallow') && current) {
      current.push(`${field}:${value}`)
    }
  }
  return groups
}

/** Extract every markdown/inline absolute URL from a text blob. */
const extractUrls = (text: string): string[] => {
  const urls: string[] = []
  const pattern = /https?:\/\/[^\s)\]"'<>]+/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    urls.push(match[0].replace(/[.,]+$/, ''))
  }
  return urls
}

describe('robots.txt', () => {
  const groups = parseRobotsGroups(robots)

  it('has a wildcard group that allows crawling and does not block the whole site', () => {
    const wildcard = groups.get('*')
    expect(wildcard, 'a "User-agent: *" group must exist').toBeDefined()
    expect(wildcard).toContain('allow:/')
    expect(wildcard).not.toContain('disallow:/')
  })

  it('references the canonical sitemap URL', () => {
    const sitemapLine = /^sitemap:\s*(.+)$/im.exec(robots)
    expect(sitemapLine, 'robots.txt must declare a Sitemap').not.toBeNull()
    expect(sitemapLine?.[1].trim()).toBe(`${SITE_URL}/sitemap.xml`)
  })

  it('explicitly welcomes the major AI search/citation and training crawlers', () => {
    // Purpose-based, intentionally small invariant set (search/citation + training controls).
    const required = [
      'gptbot',
      'oai-searchbot',
      'claudebot',
      'claude-searchbot',
      'perplexitybot',
      'google-extended'
    ]
    for (const bot of required) {
      expect(groups.has(bot), `robots.txt should list a "${bot}" group`).toBe(true)
      expect(groups.get(bot), `${bot} must be allowed`).toContain('allow:/')
    }
  })
})

describe('sitemap.xml', () => {
  const locs = [...sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1])

  it('is a non-empty urlset', () => {
    expect(sitemap).toContain('<urlset')
    expect(locs.length).toBeGreaterThan(0)
  })

  it('only lists canonical URLs on the site origin', () => {
    for (const loc of locs) {
      const url = new URL(loc)
      expect(url.origin, `${loc} must be on the site origin`).toBe(siteOrigin)
      expect(
        REDIRECTING_PATHS.has(normalizePath(url.pathname)),
        `${loc} is a redirecting path and must not be in the sitemap`
      ).toBe(false)
    }
  })

  it('includes the homepage', () => {
    const paths = locs.map((loc) => normalizePath(new URL(loc).pathname))
    expect(paths).toContain('/')
  })
})

describe('llms.txt', () => {
  const urls = extractUrls(llms)
  const internal = urls.filter((url) => new URL(url).origin === siteOrigin)

  it('only links to canonical (non-redirecting) internal pages', () => {
    expect(internal.length).toBeGreaterThan(0)
    for (const url of internal) {
      const path = normalizePath(new URL(url).pathname)
      expect(
        REDIRECTING_PATHS.has(path),
        `llms.txt links to redirecting path ${path}; use the canonical URL`
      ).toBe(false)
    }
  })

  it('points at the homepage as the main tool', () => {
    const internalPaths = internal.map((url) => normalizePath(new URL(url).pathname))
    expect(internalPaths).toContain('/')
  })

  it('advertises every WebMCP Site tool and its browser-local measurement model', () => {
    for (const toolName of [
      'list_gcp_regions',
      'start_gcp_latency_test',
      'get_gcp_latency_results',
      'stop_gcp_latency_test'
    ]) {
      expect(llms).toContain(`\`${toolName}\``)
    }
    expect(llms).toContain("visitor's browser")
    expect(llms).toMatch(/not\s+a remote MCP server/)
  })

  it('keeps external references valid and intentional', () => {
    const external = urls.filter((url) => new URL(url).origin !== siteOrigin)
    // The only expected external link is the open-source repository.
    expect(external.some((url) => url.includes('github.com/timkaboya/gcp-speed-test'))).toBe(true)
  })

  describe('Site tool hosting headers', () => {
    it('opts into an origin agent cluster and limits WebMCP tools to this origin', () => {
      expect(staticWebAppConfig.globalHeaders?.['Origin-Agent-Cluster']).toBe('?1')
      expect(staticWebAppConfig.globalHeaders?.['Permissions-Policy']).toContain('tools=(self)')
    })
  })
})

describe('index.html prerender shell', () => {
  it('ships site-level JSON-LD structured data', () => {
    expect(indexHtml).toContain('application/ld+json')
    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(indexHtml)
    expect(block, 'a JSON-LD block must be present').not.toBeNull()
    const parsed = JSON.parse(block![1]) as { '@graph'?: Array<{ '@type'?: string }> }
    const types = (parsed['@graph'] ?? []).map((node) => node['@type'])
    expect(types).toEqual(
      expect.arrayContaining(['WebSite', 'Organization', 'SoftwareApplication'])
    )
  })

  it('declares canonical social metadata on the site origin', () => {
    expect(indexHtml).toContain(`<meta property="og:url" content="${SITE_URL}/" />`)
  })
})

describe('legacy Azure naming', () => {
  it('does not leak into shipped discoverability assets', () => {
    // Legacy Azure identifiers legitimately remain in build config (angular.json,
    // package.json); they must not appear in crawler-facing content.
    for (const [name, content] of [
      ['robots.txt', robots],
      ['llms.txt', llms],
      ['sitemap.xml', sitemap]
    ] as const) {
      expect(content.toLowerCase(), `${name} must not reference azurespeed`).not.toContain(
        'azurespeed'
      )
    }
  })
})
