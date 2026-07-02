import { ChangeDetectionStrategy, Component } from '@angular/core'
import { RouterLink } from '@angular/router'

import { LucideIconComponent } from '../icons/lucide-icons.component'
import { SupportDeveloperComponent } from '../support-developer/support-developer.component'

@Component({
  selector: 'app-footer',
  imports: [RouterLink, LucideIconComponent, SupportDeveloperComponent],
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FooterComponent {
  readonly startYear = 2013
}
