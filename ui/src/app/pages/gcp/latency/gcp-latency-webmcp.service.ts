import { DOCUMENT, isPlatformBrowser } from '@angular/common'
import { computed, inject, Injectable, NgZone, OnDestroy, PLATFORM_ID } from '@angular/core'
import { Router } from '@angular/router'

import { RegionModel } from '../../../models'
import { RegionService } from '../../../services'
import {
  LATENCY_TEST_CONFIG,
  LatencyRunStatus,
  LatencyState,
  LatencyTestStore,
  ToolRunStartFailure
} from './latency-test.store'
import { WEBMCP_ENABLED } from './webmcp.constants'

export const WEBMCP_TOOL_NAMES = [
  'list_gcp_regions',
  'start_gcp_latency_test',
  'get_gcp_latency_results',
  'stop_gcp_latency_test'
] as const

export const WEBMCP_MAX_INPUT_BYTES = 4096
export const WEBMCP_MAX_RESULT_BYTES = 1536

const GEOGRAPHIES = [
  'Africa',
  'Asia Pacific',
  'Europe',
  'Global',
  'Middle East',
  'North America',
  'South America'
] as const
const GEOGRAPHY_SET = new Set<string>(GEOGRAPHIES)
const REGION_ID_PATTERN = /^(?:global|[a-z]+(?:-[a-z]+)+[0-9]{1,2})$/
const RUN_ID_PATTERN = /^gcp-[a-z0-9]{12}$/
const ACTIVE_STATUSES = new Set<LatencyRunStatus>(['starting', 'running'])

type Geography = (typeof GEOGRAPHIES)[number]
type ToolErrorCode =
  | 'INVALID_INPUT'
  | 'UNKNOWN_REGION'
  | 'NO_SELECTION'
  | 'BUSY'
  | 'COOLDOWN'
  | 'NO_RUN'
  | 'RUN_NOT_FOUND'
  | 'STALE_SNAPSHOT'
  | 'NAVIGATION_FAILED'
  | 'UNAVAILABLE'

interface ToolError {
  ok: false
  error: {
    code: ToolErrorCode
    message: string
    suggestions?: string[]
  }
}

interface ListRegionsInput {
  geography?: Geography
  query: string
  offset: number
  limit: number
}

interface StartLatencyInput {
  scope: 'all' | 'geographies' | 'regions' | 'selected'
  regionIds?: string[]
  geographies?: Geography[]
  sampleTarget: number
  replaceActive: boolean
}

interface GetResultsInput {
  runId?: string
  revision?: number
  offset: number
  limit: number
}

interface StopLatencyInput {
  runId: string
}

interface RankedResult {
  rank: number
  id: string
  name: string
  medianMs: number
  latestMs: number
  samples: number
}

type ValidationResult<T> = { ok: true; value: T } | ToolError

@Injectable({ providedIn: 'root' })
export class GcpLatencyWebMcpService implements OnDestroy {
  private readonly platformId = inject(PLATFORM_ID)
  private readonly document = inject(DOCUMENT)
  private readonly router = inject(Router)
  private readonly ngZone = inject(NgZone)
  private readonly regionService = inject(RegionService)
  private readonly latencyTestStore = inject(LatencyTestStore)
  private readonly registrationController = new AbortController()
  private initialization?: Promise<void>

  readonly statusMessage = computed(() => {
    const summary = this.latencyTestStore.toolRunSummary()
    if (!summary) {
      return ''
    }

    const { run, regionCount } = summary
    switch (run.status) {
      case 'starting':
        return `A Site tool is preparing a latency test for ${regionCount} Google Cloud regions.`
      case 'running':
        return `A Site tool is testing latency to ${regionCount} Google Cloud regions.`
      case 'completed':
        return `The Site tool latency test completed for ${regionCount} Google Cloud regions.`
      case 'partial':
        return `The Site tool latency test completed with partial results for ${regionCount} Google Cloud regions.`
      case 'cancelled':
        return 'The Site tool latency test was cancelled.'
      case 'failed':
        return 'The Site tool latency test could not collect latency results.'
    }
  })

  initialize(): Promise<void> {
    this.initialization ??= this.registerTools()
    return this.initialization
  }

  ngOnDestroy(): void {
    this.registrationController.abort()
  }

  private async registerTools(): Promise<void> {
    if (!WEBMCP_ENABLED || !isPlatformBrowser(this.platformId)) {
      return
    }

    const modelContext = this.document.modelContext
    if (typeof modelContext?.registerTool !== 'function') {
      return
    }

    try {
      await Promise.all(
        this.buildTools().map((tool) =>
          modelContext.registerTool(tool, { signal: this.registrationController.signal })
        )
      )
    } catch (error: unknown) {
      this.registrationController.abort()
      console.error('Unable to register GCP Speed Test Site tools', error)
    }
  }

  private buildTools(): WebMCP.ModelContextTool[] {
    return [
      {
        name: WEBMCP_TOOL_NAMES[0],
        title: 'List Google Cloud regions',
        description:
          'List Google Cloud regions available for browser latency testing. Filter by geography or search text and paginate the compact result.',
        inputSchema: {
          type: 'object',
          properties: {
            geography: {
              type: 'string',
              enum: GEOGRAPHIES,
              description: 'Return only regions in this geography.'
            },
            query: {
              type: 'string',
              maxLength: 64,
              description: 'Match a region ID or display name, case-insensitively.'
            },
            offset: {
              type: 'integer',
              minimum: 0,
              default: 0,
              description: 'Zero-based result offset.'
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 20,
              default: 20,
              description: 'Maximum regions to return.'
            }
          },
          additionalProperties: false
        },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: (input, { signal }) =>
          this.ngZone.run(() => this.executeListRegions(input, signal))
      },
      {
        name: WEBMCP_TOOL_NAMES[1],
        title: 'Start Google Cloud latency test',
        description:
          'Start a bounded latency test from this browser to selected Google Cloud regions. This sends HTTPS requests that expose normal network metadata to endpoint operators and updates the visible page.',
        inputSchema: {
          type: 'object',
          properties: {
            scope: {
              type: 'string',
              enum: ['all', 'geographies', 'regions', 'selected'],
              description:
                'Choose all, geography groups, explicit regions, or the current selection.'
            },
            regionIds: {
              type: 'array',
              minItems: 1,
              maxItems: 44,
              uniqueItems: true,
              items: { type: 'string', maxLength: 32, pattern: REGION_ID_PATTERN.source },
              description: 'Region IDs required only when scope is regions.'
            },
            geographies: {
              type: 'array',
              minItems: 1,
              maxItems: GEOGRAPHIES.length,
              uniqueItems: true,
              items: { type: 'string', enum: GEOGRAPHIES },
              description: 'Geographies required only when scope is geographies.'
            },
            sampleTarget: {
              type: 'integer',
              minimum: 1,
              maximum: LATENCY_TEST_CONFIG.MAX_TOOL_SAMPLES,
              default: 3,
              description: 'Recorded samples required per region.'
            },
            replaceActive: {
              type: 'boolean',
              default: false,
              description: 'Replace the active human or Site tool run when true.'
            }
          },
          required: ['scope'],
          additionalProperties: false
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input, { signal }) =>
          this.ngZone.run(() => this.executeStartLatencyTest(input, signal))
      },
      {
        name: WEBMCP_TOOL_NAMES[2],
        title: 'Get Google Cloud latency results',
        description:
          'Get status, progress, and globally ranked median latency results for the latest or specified Site tool run. Use the returned revision when requesting another page.',
        inputSchema: {
          type: 'object',
          properties: {
            runId: {
              type: 'string',
              pattern: RUN_ID_PATTERN.source,
              description: 'Site tool run ID; omit for the latest run.'
            },
            revision: {
              type: 'integer',
              minimum: 0,
              description: 'Snapshot revision returned by the first page; requires runId.'
            },
            offset: {
              type: 'integer',
              minimum: 0,
              default: 0,
              description: 'Zero-based ranked result offset.'
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 10,
              default: 10,
              description: 'Maximum ranked results to return.'
            }
          },
          additionalProperties: false
        },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: (input, { signal }) => this.ngZone.run(() => this.executeGetResults(input, signal))
      },
      {
        name: WEBMCP_TOOL_NAMES[3],
        title: 'Stop Google Cloud latency test',
        description:
          'Stop the matching Site tool latency run. Partial results stay visible and stopping an already-finished matching run is safe.',
        inputSchema: {
          type: 'object',
          properties: {
            runId: {
              type: 'string',
              pattern: RUN_ID_PATTERN.source,
              description: 'Site tool run ID to stop.'
            }
          },
          required: ['runId'],
          additionalProperties: false
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input, { signal }) =>
          this.ngZone.run(() => this.executeStopLatencyTest(input, signal))
      }
    ]
  }

  private executeListRegions(input: Record<string, unknown>, signal: AbortSignal): unknown {
    if (signal.aborted) {
      return this.cancelledError()
    }
    const validated = this.validateListRegionsInput(input)
    if (!validated.ok) {
      return validated
    }

    const { geography, query, offset, limit } = validated.value
    const normalizedQuery = query.trim().toLocaleLowerCase('en')
    const filtered = this.regionService
      .regions()
      .filter((region) => !geography || region.geography === geography)
      .filter(
        (region) =>
          !normalizedQuery ||
          region.regionId.toLocaleLowerCase('en').includes(normalizedQuery) ||
          region.displayName.toLocaleLowerCase('en').includes(normalizedQuery)
      )
      .sort(
        (a, b) =>
          a.geography.localeCompare(b.geography) ||
          a.displayName.localeCompare(b.displayName) ||
          a.regionId.localeCompare(b.regionId)
      )

    const regions = filtered.slice(offset, offset + limit).map((region) => ({
      id: region.regionId,
      name: region.displayName,
      geography: region.geography
    }))
    const response = {
      total: filtered.length,
      returned: regions.length,
      nextOffset: offset + regions.length < filtered.length ? offset + regions.length : null,
      regions
    }
    this.trimCollectionToResultBudget(response, 'regions', offset, filtered.length)
    return response
  }

  private async executeStartLatencyTest(
    input: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<unknown> {
    if (signal.aborted) {
      return this.cancelledError()
    }
    const validated = this.validateStartLatencyInput(input)
    if (!validated.ok) {
      return validated
    }

    const resolved = this.resolveStartRegions(validated.value)
    if (!resolved.ok) {
      return resolved
    }

    const reservation = this.latencyTestStore.reserveToolRun(
      resolved.value,
      validated.value.sampleTarget,
      validated.value.replaceActive
    )
    if (!reservation.ok) {
      return this.startFailure(reservation)
    }

    let navigated = this.isLatencyPage()
    if (!navigated) {
      try {
        navigated = await this.router.navigateByUrl('/')
      } catch (error: unknown) {
        this.latencyTestStore.cancelToolRunReservation(reservation.runId, 'navigation_failed')
        console.error('Unable to navigate to the latency test for a Site tool request', error)
        return this.error(
          'NAVIGATION_FAILED',
          'The latency page could not be opened, so no test was started.'
        )
      }
    }

    if (signal.aborted) {
      this.latencyTestStore.cancelToolRunReservation(reservation.runId, 'tool_cancelled')
      return this.cancelledError()
    }
    if (!navigated) {
      this.latencyTestStore.cancelToolRunReservation(reservation.runId, 'navigation_failed')
      return this.error(
        'NAVIGATION_FAILED',
        'The latency page could not be opened, so no test was started.'
      )
    }
    const viewActive = await this.latencyTestStore.waitForViewActivation(signal)
    if (signal.aborted) {
      this.latencyTestStore.cancelToolRunReservation(reservation.runId, 'tool_cancelled')
      return this.cancelledError()
    }
    if (!viewActive) {
      this.latencyTestStore.cancelToolRunReservation(reservation.runId, 'navigation_failed')
      return this.error(
        'NAVIGATION_FAILED',
        'The latency page did not become ready, so no test was started.'
      )
    }
    if (!this.latencyTestStore.commitToolRun(reservation.runId)) {
      this.latencyTestStore.cancelToolRunReservation(reservation.runId, 'page_state_changed')
      return this.error(
        'NAVIGATION_FAILED',
        'Page state changed before the latency test could start. No test was started.'
      )
    }

    return {
      ok: true,
      runId: reservation.runId,
      status: 'running',
      regionsSelected: resolved.value.length,
      targetSamples: validated.value.sampleTarget,
      pollAfterMs: LATENCY_TEST_CONFIG.PING_INTERVAL_MS,
      pollWith: WEBMCP_TOOL_NAMES[2]
    }
  }

  private executeGetResults(input: Record<string, unknown>, signal: AbortSignal): unknown {
    if (signal.aborted) {
      return this.cancelledError()
    }
    const validated = this.validateGetResultsInput(input)
    if (!validated.ok) {
      return validated
    }

    const { runId, revision, offset, limit } = validated.value
    const state = this.latencyTestStore.getToolRunState(runId)
    if (!state?.run) {
      return runId
        ? this.error('RUN_NOT_FOUND', 'No retained Site tool run matches that run ID.')
        : this.error('NO_RUN', 'No Site tool latency run is available on this page.')
    }
    if (revision !== undefined && revision !== state.revision) {
      return this.error(
        'STALE_SNAPSHOT',
        'Results changed after that revision. Request the first page again without a revision.'
      )
    }

    const ranked = this.buildRankedResults(state)
    const results = ranked.slice(offset, offset + limit)
    const response = {
      runId: state.run.runId,
      status: state.run.status,
      revision: state.revision,
      progress: {
        ready: Array.from(state.regions.values()).filter((region) => region.pingHistory.length > 0)
          .length,
        selected: state.regions.size,
        targetSamples: state.run.targetSamples
      },
      results,
      nextOffset: offset + results.length < ranked.length ? offset + results.length : null,
      pollAfterMs: ACTIVE_STATUSES.has(state.run.status)
        ? LATENCY_TEST_CONFIG.PING_INTERVAL_MS
        : null
    }
    this.trimCollectionToResultBudget(response, 'results', offset, ranked.length)
    return response
  }

  private executeStopLatencyTest(input: Record<string, unknown>, signal: AbortSignal): unknown {
    if (signal.aborted) {
      return this.cancelledError()
    }
    const validated = this.validateStopLatencyInput(input)
    if (!validated.ok) {
      return validated
    }

    const status = this.latencyTestStore.stopToolRun(validated.value.runId)
    if (!status) {
      return this.error('RUN_NOT_FOUND', 'No retained Site tool run matches that run ID.')
    }
    return { ok: true, runId: validated.value.runId, status }
  }

  private validateListRegionsInput(
    input: Record<string, unknown>
  ): ValidationResult<ListRegionsInput> {
    const record = this.validateRecord(input, ['geography', 'query', 'offset', 'limit'])
    if (!record.ok) {
      return record
    }

    const geography = record.value['geography']
    const query = record.value['query']
    const offset = record.value['offset'] ?? 0
    const limit = record.value['limit'] ?? 20
    if (
      (geography !== undefined &&
        (typeof geography !== 'string' || !GEOGRAPHY_SET.has(geography))) ||
      (query !== undefined && (typeof query !== 'string' || query.length > 64)) ||
      !this.isIntegerInRange(offset, 0, Number.MAX_SAFE_INTEGER) ||
      !this.isIntegerInRange(limit, 1, 20)
    ) {
      return this.invalidInput()
    }

    return {
      ok: true,
      value: {
        geography: geography as Geography | undefined,
        query: (query as string | undefined) ?? '',
        offset,
        limit
      }
    }
  }

  private validateStartLatencyInput(
    input: Record<string, unknown>
  ): ValidationResult<StartLatencyInput> {
    const record = this.validateRecord(input, [
      'scope',
      'regionIds',
      'geographies',
      'sampleTarget',
      'replaceActive'
    ])
    if (!record.ok) {
      return record
    }

    const scope = record.value['scope']
    const regionIds = record.value['regionIds']
    const geographies = record.value['geographies']
    const sampleTarget = record.value['sampleTarget'] ?? 3
    const replaceActive = record.value['replaceActive'] ?? false
    if (
      !this.isOneOf(scope, ['all', 'geographies', 'regions', 'selected']) ||
      !this.isIntegerInRange(sampleTarget, 1, LATENCY_TEST_CONFIG.MAX_TOOL_SAMPLES) ||
      typeof replaceActive !== 'boolean'
    ) {
      return this.invalidInput()
    }

    const validRegionIds = this.validateStringArray(regionIds, 44, (value) =>
      REGION_ID_PATTERN.test(value)
    )
    const validGeographies = this.validateStringArray(geographies, GEOGRAPHIES.length, (value) =>
      GEOGRAPHY_SET.has(value)
    )
    if (
      (regionIds !== undefined && !validRegionIds) ||
      (geographies !== undefined && !validGeographies)
    ) {
      return this.invalidInput()
    }

    const hasRegionIds = regionIds !== undefined
    const hasGeographies = geographies !== undefined
    if (
      (scope === 'regions' && (!hasRegionIds || hasGeographies)) ||
      (scope === 'geographies' && (!hasGeographies || hasRegionIds)) ||
      ((scope === 'all' || scope === 'selected') && (hasRegionIds || hasGeographies))
    ) {
      return this.invalidInput()
    }

    return {
      ok: true,
      value: {
        scope,
        regionIds: regionIds as string[] | undefined,
        geographies: geographies as Geography[] | undefined,
        sampleTarget,
        replaceActive
      }
    }
  }

  private validateGetResultsInput(
    input: Record<string, unknown>
  ): ValidationResult<GetResultsInput> {
    const record = this.validateRecord(input, ['runId', 'revision', 'offset', 'limit'])
    if (!record.ok) {
      return record
    }

    const runId = record.value['runId']
    const revision = record.value['revision']
    const offset = record.value['offset'] ?? 0
    const limit = record.value['limit'] ?? 10
    if (
      (runId !== undefined && (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId))) ||
      (revision !== undefined && !this.isIntegerInRange(revision, 0, Number.MAX_SAFE_INTEGER)) ||
      (revision !== undefined && runId === undefined) ||
      !this.isIntegerInRange(offset, 0, Number.MAX_SAFE_INTEGER) ||
      !this.isIntegerInRange(limit, 1, 10)
    ) {
      return this.invalidInput()
    }

    return {
      ok: true,
      value: {
        runId: runId as string | undefined,
        revision: revision as number | undefined,
        offset,
        limit
      }
    }
  }

  private validateStopLatencyInput(
    input: Record<string, unknown>
  ): ValidationResult<StopLatencyInput> {
    const record = this.validateRecord(input, ['runId'])
    if (!record.ok) {
      return record
    }

    const runId = record.value['runId']
    if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) {
      return this.invalidInput()
    }
    return { ok: true, value: { runId } }
  }

  private validateRecord(
    input: unknown,
    allowedKeys: string[]
  ): ValidationResult<Record<string, unknown>> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return this.invalidInput()
    }

    let serialized: string | undefined
    try {
      serialized = JSON.stringify(input)
    } catch {
      return this.invalidInput()
    }
    if (typeof serialized !== 'string' || this.byteLength(serialized) > WEBMCP_MAX_INPUT_BYTES) {
      return this.invalidInput()
    }

    const record = input as Record<string, unknown>
    if (Object.keys(record).some((key) => !allowedKeys.includes(key))) {
      return this.invalidInput()
    }
    return { ok: true, value: record }
  }

  private validateStringArray(
    value: unknown,
    maxItems: number,
    validateItem: (item: string) => boolean
  ): boolean {
    return (
      Array.isArray(value) &&
      value.length >= 1 &&
      value.length <= maxItems &&
      value.every((item) => typeof item === 'string' && item.length <= 32 && validateItem(item)) &&
      new Set(value).size === value.length
    )
  }

  private resolveStartRegions(input: StartLatencyInput): ValidationResult<RegionModel[]> {
    const allRegions = this.regionService.regions()
    switch (input.scope) {
      case 'all':
        return { ok: true, value: allRegions }
      case 'selected': {
        const selected = this.regionService.selectedRegions()
        return selected.length
          ? { ok: true, value: selected }
          : this.error('NO_SELECTION', 'No Google Cloud regions are currently selected.')
      }
      case 'geographies': {
        const selectedGeographies = new Set(input.geographies)
        return {
          ok: true,
          value: allRegions.filter((region) =>
            selectedGeographies.has(region.geography as Geography)
          )
        }
      }
      case 'regions': {
        const regionById = new Map(allRegions.map((region) => [region.regionId, region]))
        const unknown = (input.regionIds ?? []).filter((regionId) => !regionById.has(regionId))
        if (unknown.length) {
          return this.error(
            'UNKNOWN_REGION',
            'One or more region IDs are not in the current Google Cloud region catalog.',
            this.suggestRegionIds(unknown, allRegions)
          )
        }
        return {
          ok: true,
          value: (input.regionIds ?? []).map((regionId) => regionById.get(regionId) as RegionModel)
        }
      }
    }
  }

  private suggestRegionIds(unknown: string[], regions: RegionModel[]): string[] {
    return regions
      .map((region) => ({
        id: region.regionId,
        distance: Math.min(
          ...unknown.map((value) =>
            Math.min(
              this.editDistance(value, region.regionId),
              this.editDistance(value, region.displayName.toLocaleLowerCase('en'))
            )
          )
        )
      }))
      .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
      .slice(0, 5)
      .map((candidate) => candidate.id)
  }

  private editDistance(left: string, right: string): number {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      const current = [leftIndex]
      for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
        current[rightIndex] = Math.min(
          current[rightIndex - 1] + 1,
          previous[rightIndex] + 1,
          previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
        )
      }
      previous.splice(0, previous.length, ...current)
    }
    return previous[right.length]
  }

  private buildRankedResults(state: LatencyState): RankedResult[] {
    return Array.from(state.regions.values())
      .filter((region) => region.pingHistory.length > 0)
      .map((region) => ({
        region,
        medianMs: this.latencyTestStore.calculateMedian(region.pingHistory)
      }))
      .sort(
        (a, b) =>
          a.medianMs - b.medianMs ||
          a.region.displayName.localeCompare(b.region.displayName) ||
          a.region.regionId.localeCompare(b.region.regionId)
      )
      .map(({ region, medianMs }, index) => ({
        rank: index + 1,
        id: region.regionId,
        name: region.displayName,
        medianMs,
        latestMs: region.pingHistory.at(-1) ?? 0,
        samples: region.pingHistory.length
      }))
  }

  private trimCollectionToResultBudget<
    K extends 'regions' | 'results',
    T extends Record<K, unknown[]> & { returned?: number; nextOffset: number | null }
  >(response: T, collectionKey: K, offset: number, total: number): void {
    const collection = response[collectionKey]
    while (
      collection.length &&
      this.byteLength(JSON.stringify(response)) > WEBMCP_MAX_RESULT_BYTES
    ) {
      collection.pop()
    }
    if ('returned' in response) {
      response.returned = collection.length
    }
    response.nextOffset = offset + collection.length < total ? offset + collection.length : null
  }

  private startFailure(failure: ToolRunStartFailure): ToolError {
    switch (failure.code) {
      case 'BUSY':
        return this.error(
          'BUSY',
          'A latency test or another start request is active. Set replaceActive to true to replace it.'
        )
      case 'COOLDOWN':
        return this.error(
          'COOLDOWN',
          'A Site tool test started recently. Wait briefly before starting another.'
        )
      case 'INVALID_INPUT':
        return this.invalidInput()
      case 'UNAVAILABLE':
        return this.error('UNAVAILABLE', 'Browser-based latency testing is unavailable here.')
    }
  }

  private isLatencyPage(): boolean {
    const path = this.router.url.split(/[?#]/, 1)[0]
    return path === '' || path === '/'
  }

  private cancelledError(): ToolError {
    return this.error('UNAVAILABLE', 'The tool request was cancelled before it completed.')
  }

  private invalidInput(): ToolError {
    return this.error(
      'INVALID_INPUT',
      'The tool arguments do not match the required schema or allowed combinations.'
    )
  }

  private error(code: ToolErrorCode, message: string, suggestions?: string[]): ToolError {
    return {
      ok: false,
      error: {
        code,
        message,
        ...(suggestions?.length ? { suggestions } : {})
      }
    }
  }

  private isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
    return typeof value === 'string' && allowed.some((item) => item === value)
  }

  private isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
    return (
      typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= minimum &&
      value <= maximum
    )
  }

  private byteLength(value: string): number {
    return new TextEncoder().encode(value).byteLength
  }
}
