import { PLATFORM_ID } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CloudflareMetaStore } from './cloudflare-meta.store'

function createStore(platform: string): CloudflareMetaStore {
  TestBed.configureTestingModule({
    providers: [{ provide: PLATFORM_ID, useValue: platform }]
  })
  return TestBed.inject(CloudflareMetaStore)
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body
  } as unknown as Response
}

describe('CloudflareMetaStore', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('starts loading, visible and without labels', () => {
    const store = createStore('browser')
    expect(store.isLoading()).toBe(true)
    expect(store.isVisible()).toBe(true)
    expect(store.error()).toBeNull()
    expect(store.viewerIpLabel()).toBeNull()
    expect(store.viewerNetworkLabel()).toBeNull()
    expect(store.viewerLocationLabel()).toBeNull()
  })

  it('toggles visibility', () => {
    const store = createStore('browser')
    store.toggleVisibility()
    expect(store.isVisible()).toBe(false)
    store.toggleVisibility()
    expect(store.isVisible()).toBe(true)
  })

  it('populates labels on a successful load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          clientIp: '1.2.3.4',
          asn: 15169,
          asOrganization: 'Google LLC',
          city: 'Mountain View',
          country: 'US',
          colo: 'SFO'
        })
      )
    )

    const store = createStore('browser')
    await store.load()

    expect(store.isLoading()).toBe(false)
    expect(store.error()).toBeNull()
    expect(store.viewerIpLabel()).toBe('1.2.3.4')
    expect(store.viewerNetworkLabel()).toBe('Google LLC (AS15169)')
    expect(store.viewerLocationLabel()).toBe('Mountain View, US, (SFO)')
  })

  it('renders organization-only and asn-only network labels', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const store = createStore('browser')

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ clientIp: '1.1.1.1', asn: 0, asOrganization: 'Acme' })
    )
    await store.load()
    expect(store.viewerNetworkLabel()).toBe('Acme')

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ clientIp: '2.2.2.2', asn: 64500, asOrganization: '   ' })
    )
    await store.load()
    expect(store.viewerNetworkLabel()).toBe('AS64500')
  })

  it('sets an error when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 500)))
    const store = createStore('browser')
    await store.load()
    expect(store.error()).toBe('Unable to determine your network details.')
    expect(store.viewerIpLabel()).toBeNull()
  })

  it('sets an error when the payload shape is unexpected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ asn: 1 })))
    const store = createStore('browser')
    await store.load()
    expect(store.error()).toBe('Unable to determine your network details.')
  })

  it('ignores abort errors without setting an error state', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))
    const store = createStore('browser')
    await store.load()
    expect(store.error()).toBeNull()
  })

  it('is a no-op on the server', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const store = createStore('server')
    await store.load()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('destroy aborts an in-flight request', () => {
    const store = createStore('browser')
    expect(() => store.destroy()).not.toThrow()
  })
})
