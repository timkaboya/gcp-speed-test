import { Routes } from '@angular/router'

export const INFORMATION_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./information.component').then((_) => _.InformationComponent),
    children: [
      {
        path: 'GcpRegions',
        loadComponent: () =>
          import('./gcp-regions/gcp-regions.component').then((_) => _.GcpRegionsComponent)
      },
      {
        path: '',
        redirectTo: 'GcpRegions',
        pathMatch: 'full'
      },
      {
        path: '**',
        loadComponent: () =>
          import('../shared/not-found/not-found.component').then((_) => _.NotFoundComponent)
      }
    ]
  }
]
