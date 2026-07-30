import { Routes } from '@angular/router'

// The latency test is now the site homepage (served at '/'). These routes
// consolidate the legacy '/Gcp/Latency' and '/Gcp' URLs to the root so
// previously indexed/linked URLs keep resolving instead of 404ing.
export const GCP_ROUTES: Routes = [
  {
    path: 'Latency',
    redirectTo: '/',
    pathMatch: 'full'
  },
  {
    path: '',
    redirectTo: '/',
    pathMatch: 'full'
  }
]
