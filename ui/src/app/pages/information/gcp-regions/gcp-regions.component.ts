import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core'
import { RouterLink } from '@angular/router'

import { RegionService, SeoService } from '../../../services'

@Component({
  selector: 'app-gcp-regions',
  imports: [RouterLink],
  templateUrl: './gcp-regions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GcpRegionsComponent implements OnInit {
  private readonly regionService = inject(RegionService)
  private readonly seoService = inject(SeoService)

  readonly regionGroups = this.regionService.regionGroups
  readonly totalRegionCount = computed(() => this.regionService.regions().length)

  ngOnInit(): void {
    this.seoService.applyPageSeo({
      title: 'Google Cloud Regions | GCP Speed Test',
      description:
        'Explore Google Cloud regions grouped by geography. See every Cloud Run region available in the GCP Speed Test latency tool.',
      path: '/Information/GcpRegions'
    })
  }
}
