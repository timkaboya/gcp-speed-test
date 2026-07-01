import { Routes } from '@angular/router'

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/gcp/gcp.component').then((_) => _.GcpComponent),
    children: [
      {
        path: 'Gcp',
        loadChildren: () => import('./pages/gcp/gcp-routes').then((_) => _.GCP_ROUTES)
      },
      {
        path: 'Information',
        loadChildren: () =>
          import('./pages/information/information-routes').then((_) => _.INFORMATION_ROUTES)
      },
      {
        path: 'Privacy',
        loadComponent: () =>
          import('./pages/privacy/privacy.component').then((_) => _.PrivacyComponent)
      },
      {
        path: '',
        redirectTo: 'Gcp/Latency',
        pathMatch: 'full'
      }
    ]
  },
  {
    path: '**',
    redirectTo: 'Gcp/Latency'
  }
]
