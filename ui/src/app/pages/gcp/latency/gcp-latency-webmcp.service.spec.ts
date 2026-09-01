import { PLATFORM_ID } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { Router } from '@angular/router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RegionService } from '../../../services'
import {
  GcpLatencyWebMcpService,
  WEBMCP_MAX_RESULT_BYTES,
  WEBMCP_TOOL_NAMES
} from './gcp-latency-webmcp.service'
import { LatencyTestStore } from './latency-test.store'

type ToolName = (typeof WEBMCP_TOOL_NAMES)[number]

class FakeModelContext extends EventTarget implements WebMCP.ModelContext {
  ontoolchange: ((this: WebMCP.ModelContext, ev: Event) => unknown) | null = null
  readonly tools = new Map<string, WebMCP.ModelContextTool>()
  readonly registrationOptions = new Map<string, WebMCP.ModelContextRegisterToolOptions>()
  registerCalls = 0
  registrationError?: Error

  async registerTool(
    tool: WebMCP.ModelContextTool,
    options: WebMCP.ModelContextRegisterToolOptions = {}
  ): Promise<void> {
    this.registerCalls += 1
    if (this.registrationError) {
      throw this.registrationError
    }
    this.tools.set(tool.name, tool)
    this.registrationOptions.set(tool.name, options)
    options.signal?.addEventListener(
      'abort',
      () => {
        this.tools.delete(tool.name)
        this.registrationOptions.delete(tool.name)
      },
      { once: true }
    )
  }

  getTools(): Promise<WebMCP.RegisteredTool[]> {
    return Promise.resolve([])
  }
}

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a record result')
  }
  return value as Record<string, unknown>
}

const getString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key]
  if (typeof value !== 'string') {
    throw new Error(`Expected ${key} to be a string`)
  }
  return value
}

const resultBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for WebMCP test condition')
    }
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

describe('GcpLatencyWebMcpService', () => {
  let modelContext: FakeModelContext
  let service: GcpLatencyWebMcpService
  let store: LatencyTestStore
  let regionService: RegionService
  let navigationInProgress: boolean
  let navigateByUrl: ReturnType<typeof vi.fn>
  let routerStub: {
    url: string
    navigated: boolean
    currentNavigation: () => object | null
    navigateByUrl: ReturnType<typeof vi.fn>
  }

  const execute = async (
    name: ToolName,
    input: Record<string, unknown> = {},
    signal = new AbortController().signal
  ): Promise<unknown> => {
    const tool = modelContext.tools.get(name)
    if (!tool) {
      throw new Error(`Tool ${name} was not registered`)
    }
    return await tool.execute(input, { signal })
  }

  beforeEach(async () => {
    modelContext = new FakeModelContext()
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: modelContext
    })
    navigationInProgress = false
    navigateByUrl = vi.fn()
    routerStub = {
      url: '/Privacy',
      navigated: true,
      currentNavigation: () => (navigationInProgress ? {} : null),
      navigateByUrl
    }
    navigateByUrl.mockImplementation(async (url: string) => {
      routerStub.url = url
      routerStub.navigated = true
      navigationInProgress = false
      return true
    })
    TestBed.configureTestingModule({
      providers: [
        GcpLatencyWebMcpService,
        LatencyTestStore,
        RegionService,
        { provide: Router, useValue: routerStub },
        { provide: PLATFORM_ID, useValue: 'browser' }
      ]
    })
    service = TestBed.inject(GcpLatencyWebMcpService)
    store = TestBed.inject(LatencyTestStore)
    regionService = TestBed.inject(RegionService)
    await service.initialize()
  })

  afterEach(() => {
    store.deactivate()
    delete (document as { modelContext?: WebMCP.ModelContext }).modelContext
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('registers the four top-level tools once with strict schemas and annotations', async () => {
    await service.initialize()

    expect(modelContext.registerCalls).toBe(4)
    expect(Array.from(modelContext.tools.keys())).toEqual(WEBMCP_TOOL_NAMES)
    for (const [name, tool] of modelContext.tools) {
      expect(tool.description.length, name).toBeLessThan(500)
      expect(tool.inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false
      })
      expect(tool.annotations?.untrustedContentHint).toBe(false)
      expect(modelContext.registrationOptions.get(name)?.exposedTo).toBeUndefined()
      expect(modelContext.registrationOptions.get(name)?.signal).toBeInstanceOf(AbortSignal)
    }
    expect(modelContext.tools.get('list_gcp_regions')?.annotations?.readOnlyHint).toBe(true)
    expect(modelContext.tools.get('get_gcp_latency_results')?.annotations?.readOnlyHint).toBe(true)
    expect(modelContext.tools.get('start_gcp_latency_test')?.annotations?.readOnlyHint).toBe(false)
    expect(modelContext.tools.get('stop_gcp_latency_test')?.annotations?.readOnlyHint).toBe(false)
  })

  it('unregisters every tool through the shared lifecycle signal', () => {
    service.ngOnDestroy()
    expect(modelContext.tools.size).toBe(0)
    expect(modelContext.registrationOptions.size).toBe(0)
  })

  it('accepts Chrome invocations that omit the optional execution context', async () => {
    const tool = modelContext.tools.get('list_gcp_regions')
    expect(tool).toBeDefined()

    const result = await Reflect.apply(tool!.execute, undefined, [{ limit: 1 }])

    expect(result).toMatchObject({ returned: 1 })
  })

  it('lists filtered regions with stable pagination and no endpoint URLs', async () => {
    const first = asRecord(
      await execute('list_gcp_regions', {
        geography: 'Europe',
        query: 'west',
        offset: 0,
        limit: 2
      })
    )

    expect(first['total']).toBeGreaterThan(2)
    expect(first['returned']).toBe(2)
    expect(first['nextOffset']).toBe(2)
    expect(JSON.stringify(first)).not.toContain('a.run.app')

    const second = asRecord(
      await execute('list_gcp_regions', {
        geography: 'Europe',
        query: 'west',
        offset: first['nextOffset'],
        limit: 2
      })
    )
    expect(second['regions']).not.toEqual(first['regions'])
  })

  it('keeps the largest region-list response inside the output budget', async () => {
    const result = await execute('list_gcp_regions', { limit: 20 })
    const record = asRecord(result)

    expect(resultBytes(result)).toBeLessThanOrEqual(WEBMCP_MAX_RESULT_BYTES)
    expect(record['returned']).toBeLessThanOrEqual(20)
    expect(record['nextOffset']).toBeTypeOf('number')
  })

  it('rejects invalid, extra, duplicate, oversized, and cancelled list inputs', async () => {
    await expect(execute('list_gcp_regions', { limit: 0 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' }
    })
    await expect(execute('list_gcp_regions', { unexpected: true })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' }
    })
    await expect(execute('list_gcp_regions', { query: 'x'.repeat(5000) })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' }
    })

    const controller = new AbortController()
    controller.abort()
    await expect(execute('list_gcp_regions', {}, controller.signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'UNAVAILABLE' }
    })
  })

  it('validates start scope combinations and suggests current IDs for unknown regions', async () => {
    await expect(execute('start_gcp_latency_test', { scope: 'regions' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' }
    })
    await expect(
      execute('start_gcp_latency_test', {
        scope: 'regions',
        regionIds: ['europe-west2', 'europe-west2']
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' }
    })

    const unknown = asRecord(
      await execute('start_gcp_latency_test', {
        scope: 'regions',
        regionIds: ['europe-west5']
      })
    )
    expect(unknown).toMatchObject({
      ok: false,
      error: {
        code: 'UNKNOWN_REGION',
        suggestions: expect.arrayContaining(['europe-west4'])
      }
    })
    expect(JSON.stringify(unknown)).not.toContain('europe-west5')

    await expect(execute('start_gcp_latency_test', { scope: 'selected' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'NO_SELECTION' }
    })
  })

  it('starts a visible bounded run and rejects a concurrent start by default', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, request: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = request.signal as AbortSignal
            signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            )
          })
      )
    )
    store.activate()

    const started = asRecord(
      await execute('start_gcp_latency_test', {
        scope: 'regions',
        regionIds: ['europe-west2', 'us-central1'],
        sampleTarget: 3
      })
    )
    const runId = getString(started, 'runId')

    expect(started).toMatchObject({
      ok: true,
      status: 'running',
      regionsSelected: 2,
      targetSamples: 3,
      pollWith: 'get_gcp_latency_results'
    })
    expect(navigateByUrl).toHaveBeenCalledWith('/')
    expect(regionService.selectedRegions().map((region) => region.regionId)).toEqual([
      'europe-west2',
      'us-central1'
    ])
    expect(store.run()).toMatchObject({ runId, owner: 'webmcp', status: 'running' })
    expect(service.statusMessage()).toContain('Site tool is testing latency')

    await expect(execute('start_gcp_latency_test', { scope: 'all' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'BUSY' }
    })
  })

  it('starts from the current latency page without treating same-URL navigation as a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise<Response>(() => undefined))
    )
    routerStub.url = '/?regions=europe-west2'
    store.activate()

    const started = await execute('start_gcp_latency_test', {
      scope: 'regions',
      regionIds: ['europe-west2']
    })

    expect(started).toMatchObject({ ok: true, status: 'running' })
    expect(navigateByUrl).not.toHaveBeenCalled()
  })

  it('forces root navigation while the router still exposes its pre-navigation root URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise<Response>(() => undefined))
    )
    routerStub.url = '/'
    routerStub.navigated = false
    navigationInProgress = true

    const started = await execute('start_gcp_latency_test', {
      scope: 'regions',
      regionIds: ['europe-west2']
    })

    expect(started).toMatchObject({ ok: true, status: 'running' })
    expect(navigateByUrl).toHaveBeenCalledWith('/')
  })

  it('activates the store before committing a cross-route run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise<Response>(() => undefined))
    )
    const started = await execute('start_gcp_latency_test', {
      scope: 'regions',
      regionIds: ['europe-west2']
    })

    expect(started).toMatchObject({ ok: true, status: 'running' })
    expect(store.run()).toMatchObject({ owner: 'webmcp', status: 'running' })
  })

  it('returns compact globally ranked snapshots and supports terminal pagination', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => {
      now += 10
      return now
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({} as Response))
    store.activate()

    const started = asRecord(
      await execute('start_gcp_latency_test', {
        scope: 'regions',
        regionIds: ['us-central1', 'europe-west2'],
        sampleTarget: 1
      })
    )
    const runId = getString(started, 'runId')
    await waitUntil(() => store.run()?.status === 'completed')

    const first = asRecord(await execute('get_gcp_latency_results', { runId, offset: 0, limit: 1 }))
    expect(first).toMatchObject({
      runId,
      status: 'completed',
      progress: { ready: 2, selected: 2, targetSamples: 1 },
      nextOffset: 1,
      pollAfterMs: null
    })
    expect(resultBytes(first)).toBeLessThanOrEqual(WEBMCP_MAX_RESULT_BYTES)
    expect(JSON.stringify(first)).not.toMatch(/a\.run\.app|url|ipAddress/)

    const revision = first['revision']
    const second = asRecord(
      await execute('get_gcp_latency_results', { runId, revision, offset: 1, limit: 1 })
    )
    expect(second['nextOffset']).toBeNull()
    expect(second['results']).not.toEqual(first['results'])

    await expect(
      execute('get_gcp_latency_results', {
        runId,
        revision: Number(revision) + 1
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'STALE_SNAPSHOT' }
    })

    await expect(execute('stop_gcp_latency_test', { runId })).resolves.toEqual({
      ok: true,
      runId,
      status: 'completed'
    })
  })

  it('stops an active run idempotently and retains its snapshot after navigation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, request: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = request.signal as AbortSignal
            signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            )
          })
      )
    )
    store.activate()
    const started = asRecord(
      await execute('start_gcp_latency_test', {
        scope: 'regions',
        regionIds: ['europe-west2']
      })
    )
    const runId = getString(started, 'runId')

    await expect(execute('stop_gcp_latency_test', { runId })).resolves.toEqual({
      ok: true,
      runId,
      status: 'cancelled'
    })
    store.deactivate()

    await expect(execute('stop_gcp_latency_test', { runId })).resolves.toEqual({
      ok: true,
      runId,
      status: 'cancelled'
    })
    await expect(execute('get_gcp_latency_results', { runId })).resolves.toMatchObject({
      runId,
      status: 'cancelled'
    })
  })

  it('distinguishes an absent latest run from an unknown retained run ID', async () => {
    await expect(execute('get_gcp_latency_results', { revision: 0 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' }
    })
    await expect(execute('get_gcp_latency_results')).resolves.toMatchObject({
      ok: false,
      error: { code: 'NO_RUN' }
    })
    await expect(
      execute('get_gcp_latency_results', { runId: 'gcp-000000000000' })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'RUN_NOT_FOUND' }
    })
    await expect(
      execute('stop_gcp_latency_test', { runId: 'gcp-000000000000' })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'RUN_NOT_FOUND' }
    })
  })

  it('releases a reservation when navigation fails so no ghost run remains', async () => {
    store.activate()
    navigateByUrl.mockResolvedValueOnce(false)

    await expect(
      execute('start_gcp_latency_test', {
        scope: 'regions',
        regionIds: ['europe-west2']
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'NAVIGATION_FAILED' }
    })
    expect(store.run()).toBeNull()

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise<Response>(() => undefined))
    )
    const retry = asRecord(
      await execute('start_gcp_latency_test', {
        scope: 'regions',
        regionIds: ['europe-west2']
      })
    )
    expect(retry['ok']).toBe(true)
  })

  it('releases a reservation when the tool execution is cancelled during navigation', async () => {
    store.activate()
    let finishNavigation: ((result: boolean) => void) | undefined
    navigateByUrl.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishNavigation = resolve
      })
    )
    const controller = new AbortController()
    const pending = execute(
      'start_gcp_latency_test',
      { scope: 'regions', regionIds: ['europe-west2'] },
      controller.signal
    )

    await Promise.resolve()
    controller.abort()
    finishNavigation?.(true)

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { code: 'UNAVAILABLE' }
    })
    expect(store.run()).toBeNull()
  })

  it('logs registration failures without rejecting application initialization', async () => {
    TestBed.resetTestingModule()
    modelContext = new FakeModelContext()
    modelContext.registrationError = new Error('registration failed')
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: modelContext
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    TestBed.configureTestingModule({
      providers: [
        GcpLatencyWebMcpService,
        LatencyTestStore,
        RegionService,
        { provide: Router, useValue: routerStub },
        { provide: PLATFORM_ID, useValue: 'browser' }
      ]
    })
    service = TestBed.inject(GcpLatencyWebMcpService)
    store = TestBed.inject(LatencyTestStore)

    await expect(service.initialize()).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalledWith(
      'Unable to register GCP Speed Test Site tools',
      modelContext.registrationError
    )
    expect(modelContext.tools.size).toBe(0)
  })

  it('does not register tools during server rendering', async () => {
    TestBed.resetTestingModule()
    modelContext = new FakeModelContext()
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: modelContext
    })
    TestBed.configureTestingModule({
      providers: [
        GcpLatencyWebMcpService,
        LatencyTestStore,
        RegionService,
        { provide: Router, useValue: routerStub },
        { provide: PLATFORM_ID, useValue: 'server' }
      ]
    })
    service = TestBed.inject(GcpLatencyWebMcpService)
    store = TestBed.inject(LatencyTestStore)

    await service.initialize()
    expect(modelContext.registerCalls).toBe(0)
  })
})
