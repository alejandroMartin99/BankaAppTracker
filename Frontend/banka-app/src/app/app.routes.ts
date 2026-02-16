import { Routes } from '@angular/router';
import { LayoutComponent } from './layout/layout.component';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent) },
  { path: 'register', loadComponent: () => import('./pages/register/register.component').then(m => m.RegisterComponent) },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'gastos', pathMatch: 'full' },
      { path: 'gastos', loadComponent: () => import('./pages/gastos/gastos.component').then(m => m.GastosComponent) },
      { path: 'resumen', loadComponent: () => import('./pages/resumen/resumen.component').then(m => m.ResumenComponent) },
      { path: 'ajustes', loadComponent: () => import('./pages/ajustes/ajustes.component').then(m => m.AjustesComponent) }
    ]
  },
  { path: '**', redirectTo: 'gastos' }
];
