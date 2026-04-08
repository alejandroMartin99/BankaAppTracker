import { Component } from '@angular/core';

@Component({
  selector: 'app-inversion',
  standalone: true,
  template: `
    <section style="padding: 12px; border: 1px solid var(--color-border-light); border-radius: 10px; background: var(--color-surface);">
      <h2 style="margin: 0 0 8px 0; font-size: 14px;">Inversión</h2>
      <p style="margin: 0; font-size: 12px; color: var(--color-text-muted);">
        Módulo en preparación. Aquí tendrás cartera, aportaciones y rentabilidad.
      </p>
    </section>
  `
})
export class InversionComponent {}

