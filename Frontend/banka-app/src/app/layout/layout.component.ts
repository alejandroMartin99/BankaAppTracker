import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { TransactionService, UploadResponse } from '../services/transaction.service';
import { AuthService } from '../services/auth.service';

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.scss'
})
export class LayoutComponent {
  navItems = [
    { path: '/gastos', label: 'Gastos', icon: 'receipt' },
    { path: '/resumen', label: 'Resumen', icon: 'chart' },
    { path: '/ajustes', label: 'Ajustes', icon: 'settings' }
  ];

  uploadStatus: UploadStatus = 'idle';
  uploadMessage = '';
  uploadSourceType: string | null = null;
  uploadSummary: UploadResponse['summary'] | null = null;
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public router: Router,
    private transactionService: TransactionService,
    public auth: AuthService
  ) {}

  async logout() {
    await this.auth.signOut();
    this.router.navigateByUrl('/login');
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) return;

    this.uploadStatus = 'uploading';
    this.uploadMessage = `Subiendo ${file.name}...`;

    this.transactionService.uploadTransactions(file).subscribe({
      next: (res) => {
        input.value = '';
        this.uploadStatus = 'success';
        this.uploadSourceType = res.source_type ?? null;
        this.uploadSummary = res.summary ?? null;
        this.uploadMessage = this.buildSuccessMessage(res);
        this.transactionService.dataRefresh$.next();
        this.scheduleToastDismiss();
      },
      error: (err) => {
        input.value = '';
        this.uploadStatus = 'error';
        this.uploadSourceType = null;
        this.uploadSummary = null;
        this.uploadMessage = err.error?.detail || 'No se pudo conectar con el servidor. Comprueba que el backend esté en marcha.';
        this.scheduleToastDismiss();
      }
    });
  }

  private buildSuccessMessage(res: UploadResponse): string {
    const source = res.source_type || 'Extracto';
    const s = res.summary;
    if (!s) return `${source} importado correctamente.`;

    const inserted = s.total_inserted;
    const dupes = s.total_duplicates;

    if (inserted === 0 && dupes > 0) {
      return `${source}: ${dupes} transacción(es) ya existían. Nada nuevo que importar.`;
    }
    if (dupes === 0) {
      return `${source}: ${inserted} transacción(es) importadas correctamente.`;
    }
    return `${source}: ${inserted} nueva(s) importada(s), ${dupes} duplicada(s) omitida(s).`;
  }

  private scheduleToastDismiss() {
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.uploadStatus = 'idle';
      this.uploadMessage = '';
      this.uploadSourceType = null;
      this.uploadSummary = null;
      this.toastTimeout = null;
    }, 5000);
  }

  dismissToast() {
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.uploadStatus = 'idle';
    this.uploadMessage = '';
    this.uploadSourceType = null;
    this.uploadSummary = null;
    this.toastTimeout = null;
  }

  get uploadToastTitle(): string {
    if (this.uploadStatus === 'success' && this.uploadSourceType) {
      return `${this.uploadSourceType} importado`;
    }
    return 'Importación correcta';
  }
}
