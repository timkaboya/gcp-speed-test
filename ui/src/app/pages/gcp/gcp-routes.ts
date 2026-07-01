import { Routes } from '@angular/router'

export const GCP_ROUTES: Routes = [
  {
    path: 'Latency',
    loadComponent: () => import('./latency/latency.component').then((_) => _.LatencyComponent)
  },
  {
    path: '',
    redirectTo: 'Latency',
    pathMatch: 'full'
  }
]
