import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-ajustes',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page-header">
      <h1 class="page-title">Ajustes</h1>
      <p class="page-subtitle">Próximamente: configuración de la aplicación</p>
    </div>
    <div class="placeholder">
      <span class="placeholder-icon">⚙️</span>
      <p>Esta pestaña estará disponible próximamente</p>
    </div>
  `,
  styleUrl: './ajustes.component.scss'
})
export class AjustesComponent {}
