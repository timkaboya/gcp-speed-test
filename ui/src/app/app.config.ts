import { provideHttpClient, withFetch } from '@angular/common/http'
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners
} from '@angular/core'
import { provideClientHydration, withEventReplay } from '@angular/platform-browser'
import { provideRouter } from '@angular/router'

import { routes } from './app.routes'
import { GcpLatencyWebMcpService } from './pages/gcp/latency/gcp-latency-webmcp.service'

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideClientHydration(withEventReplay()),
    provideAppInitializer(() => inject(GcpLatencyWebMcpService).initialize())
  ]
}
