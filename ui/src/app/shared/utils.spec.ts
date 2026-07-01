import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildRegionDetailRouterLink, createCopyToClipboard, toRegionNameNoSpace } from './utils'

describe('toRegionNameNoSpace', () => {
  it('removes all whitespace from a display name', () => {
    expect(toRegionNameNoSpace('South America East')).toBe('SouthAmericaEast')
  })

  it('leaves names without whitespace untouched', () => {
    expect(toRegionNameNoSpace('europe')).toBe('europe')
  })
})

describe('buildRegionDetailRouterLink', () => {
  it('returns the GCP regions router link', () => {
    expect(buildRegionDetailRouterLink()).toEqual(['/Information/GcpRegions'])
  })
})

describe('createCopyToClipboard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('starts in the idle state', () => {
    const clipboard = createCopyToClipboard()
    expect(clipboard.copyStatus()).toBe('idle')
    expect(clipboard.isCopyIdle()).toBe(true)
    expect(clipboard.isCopySuccess()).toBe(false)
    expect(clipboard.isCopyError()).toBe(false)
  })

  it('does nothing when copying empty text', async () => {
    const clipboard = createCopyToClipboard()
    await clipboard.copyText('')
    expect(clipboard.copyStatus()).toBe('idle')
  })

  it('marks status copied on success and resets after the timeout', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    const clipboard = createCopyToClipboard({ resetMs: 1000 })
    await clipboard.copyText('hello')

    expect(writeText).toHaveBeenCalledWith('hello')
    expect(clipboard.isCopySuccess()).toBe(true)

    vi.advanceTimersByTime(1000)
    expect(clipboard.isCopyIdle()).toBe(true)
  })

  it('marks status failed when the clipboard API is unavailable', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const clipboard = createCopyToClipboard()
    await clipboard.copyText('hello')

    expect(clipboard.isCopyError()).toBe(true)
  })

  it('marks status failed when writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const clipboard = createCopyToClipboard()
    await clipboard.copyText('hello')

    expect(clipboard.isCopyError()).toBe(true)
  })

  it('cancels a pending reset when destroyed', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    const clipboard = createCopyToClipboard({ resetMs: 1000 })
    await clipboard.copyText('hello')
    expect(clipboard.isCopySuccess()).toBe(true)

    clipboard.destroy()
    vi.advanceTimersByTime(1000)
    expect(clipboard.isCopySuccess()).toBe(true)
  })

  it('setStatus idle clears any pending reset', () => {
    const clipboard = createCopyToClipboard()
    clipboard.setStatus('copied')
    expect(clipboard.isCopySuccess()).toBe(true)
    clipboard.setStatus('idle')
    expect(clipboard.isCopyIdle()).toBe(true)
  })
})
