import { PLATFORM_ID } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ExportCsvButtonComponent } from './export-csv-button.component'

function createFixture(platform: string): ComponentFixture<ExportCsvButtonComponent> {
  TestBed.configureTestingModule({
    imports: [ExportCsvButtonComponent],
    providers: [{ provide: PLATFORM_ID, useValue: platform }]
  })
  const fixture = TestBed.createComponent(ExportCsvButtonComponent)
  fixture.componentRef.setInput('filename', 'latency')
  fixture.componentRef.setInput('headers', ['Region', 'Latency'])
  fixture.componentRef.setInput('rows', [
    ['Oregon', '12'],
    ['Sao Paulo, Brazil', '250"x']
  ])
  fixture.detectChanges()
  return fixture
}

describe('ExportCsvButtonComponent', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('mounts with an enabled button when rows are present', () => {
    const fixture = createFixture('browser')
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')
    expect(button?.disabled).toBe(false)
  })

  it('disables the button when there are no rows', () => {
    const fixture = createFixture('browser')
    fixture.componentRef.setInput('rows', null)
    fixture.detectChanges()
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')
    expect(button?.disabled).toBe(true)
  })

  describe('export()', () => {
    let createObjectURL: ReturnType<typeof vi.fn>
    let revokeObjectURL: ReturnType<typeof vi.fn>
    let capturedBlob: Blob | undefined

    beforeEach(() => {
      capturedBlob = undefined
      createObjectURL = vi.fn((blob: Blob) => {
        capturedBlob = blob
        return 'blob:mock'
      })
      revokeObjectURL = vi.fn()
      vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    })

    it('creates and revokes a CSV object URL with escaped fields', async () => {
      const fixture = createFixture('browser')
      fixture.componentInstance.export()

      expect(createObjectURL).toHaveBeenCalledTimes(1)
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')

      const csv = await capturedBlob!.text()
      expect(csv).toContain('Region,Latency')
      expect(csv).toContain('Oregon,12')
      // Fields with commas/quotes are wrapped and quotes doubled.
      expect(csv).toContain('"Sao Paulo, Brazil"')
      expect(csv).toContain('"250""x"')
    })

    it('does nothing on the server', () => {
      const fixture = createFixture('server')
      fixture.componentInstance.export()
      expect(createObjectURL).not.toHaveBeenCalled()
    })

    it('does nothing when there are no rows', () => {
      const fixture = createFixture('browser')
      fixture.componentRef.setInput('rows', [])
      fixture.detectChanges()
      fixture.componentInstance.export()
      expect(createObjectURL).not.toHaveBeenCalled()
    })
  })
})
