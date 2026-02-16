import { Routes } from '@angular/router';
import { LayoutComponent } from './layout/layout.component';

export const routes: Routes = [
  {
    path: '',
    component: LayoutComponent,
    children: [
      { path: '', redirectTo: 'gastos', pathMatch: 'full' },
      { path: 'gastos', loadComponent: () => import('./pages/gastos/gastos.component').then(m => m.GastosComponent) },
      { path: 'resumen', loadComponent: () => import('./pages/resumen/resumen.component').then(m => m.ResumenComponent) },
      { path: 'ajustes', loadComponent: () => import('./pages/ajustes/ajustes.component').then(m => m.AjustesComponent) }
    ]
  },
  { path: '**', redirectTo: 'gastos' }
];
