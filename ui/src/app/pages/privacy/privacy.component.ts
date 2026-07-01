import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core'

import { SeoService } from '../../services'

@Component({
  selector: 'app-privacy',
  templateUrl: './privacy.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PrivacyComponent implements OnInit {
  private readonly seoService = inject(SeoService)

  ngOnInit(): void {
    this.seoService.applyPageSeo({
      title: 'Privacy Policy - GCP Speed Test',
      description:
        'Understand how GCP Speed Test handles analytics data and protects your information during latency measurements.',
      path: '/Privacy'
    })
  }
}
