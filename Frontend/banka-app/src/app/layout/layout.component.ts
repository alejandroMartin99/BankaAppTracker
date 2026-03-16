import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { TransactionService, UploadResponse } from '../services/transaction.service';
import { AuthService } from '../services/auth.service';
import { Account } from '../models/transaction.model';
import { BackendLoaderService } from '../services/backend-loader.service';

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.scss'
})
export class LayoutComponent {
  /** Orden: izquierda → centro → derecha: Resumen, Charts, Gastos (central), Compartidos, Ajustes */
  navItems = [
    { path: '/resumen', label: 'Resumen', icon: 'resumen' },
    { path: '/charts', label: 'Charts', icon: 'chart' },
    { path: '/gastos', label: 'Gastos', icon: 'receipt', center: true },
    { path: '/gastos-compartidos', label: 'Compartidos', icon: 'people' },
    { path: '/ajustes', label: 'Ajustes', icon: 'settings' }
  ];

  uploadStatus: UploadStatus = 'idle';
  uploadMessage = '';
  uploadSourceType: string | null = null;
  uploadSummary: UploadResponse['summary'] | null = null;
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  profileMenuOpen = false;
  private avatarError = false;

  // Perfil (nombre y avatar)
  profileName = '';
  profileAvatarUrl = '';
  profileSaving = false;
  profileError: string | null = null;

  // Modal avatar
  avatarModalOpen = false;
  avatarUploadFileName = '';
  avatarUploadError: string | null = null;
  avatarUploading = false;

  // Cuentas vinculadas (para menú de usuario)
  accounts: Account[] = [];
  accountsLoading = false;
  accountsError: string | null = null;
  accountDraftName: Record<string, string> = {};
  editingAccountId: string | null = null;
  savingAccountId: string | null = null;
  renameSharedConfirmOpen = false;
  renamePendingAccount: Account | null = null;
  renamePendingName = '';

  constructor(
    public router: Router,
    private transactionService: TransactionService,
    public auth: AuthService,
    public backendLoader: BackendLoaderService
  ) {}

  get avatarDisplayName(): string {
    return this.auth.displayName();
  }

  get avatarInitials(): string {
    const name = this.avatarDisplayName || (this.auth.user()?.email ?? '');
    const trimmed = name.trim();
    if (!trimmed) return '';
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    if (parts[0].includes('@')) {
      const local = parts[0].split('@')[0];
      if (local.length >= 2) return (local[0] + local[1]).toUpperCase();
      return local[0].toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }

  get avatarUrl(): string | null {
    if (this.avatarError) return null;
    const u: any = this.auth.user();
    const meta = u?.user_metadata || {};
    const url: string | undefined =
      meta['avatar_url'] || meta['picture'] || meta['avatar'] || undefined;
    if (typeof url === 'string' && url.trim().length > 0) {
      return url.trim();
    }
    return null;
  }

  onAvatarError(): void {
    this.avatarError = true;
  }

  openAvatarModal(): void {
    this.avatarUploadError = null;
    this.avatarUploadFileName = '';
    this.avatarModalOpen = true;
  }

  closeAvatarModal(): void {
    this.avatarModalOpen = false;
  }

  toggleProfileMenu(): void {
    this.profileMenuOpen = !this.profileMenuOpen;
    if (this.profileMenuOpen) {
      this.ensureProfileLoaded();
      this.ensureAccountsLoaded();
    }
  }

  closeProfileMenu(): void {
    this.profileMenuOpen = false;
  }

  goToProfile(): void {
  }

  private ensureProfileLoaded(): void {
    if (!this.profileName) {
      const u: any = this.auth.user();
      const meta: any = u?.user_metadata || {};
      this.profileName = this.auth.displayName();
      this.profileAvatarUrl = meta['avatar_url'] || meta['picture'] || meta['avatar'] || '';
    }
  }

  private ensureAccountsLoaded(): void {
    if (this.accounts.length === 0 && !this.accountsLoading && !this.accountsError) {
      this.loadAccounts();
    }
  }

  async saveProfile(): Promise<void> {
    this.profileError = null;
    this.profileSaving = true;
    const { error } = await this.auth.updateProfile(this.profileName, this.profileAvatarUrl);
    this.profileSaving = false;
    if (error) {
      this.profileError = error.message || 'No se han podido guardar los cambios de perfil.';
    }
  }

  onAvatarFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) {
      this.avatarUploadFileName = '';
      return;
    }
    this.avatarUploadFileName = file.name;
    this.avatarUploadError = null;
    // Guardamos temporalmente el File en una propiedad privada
    (this as any)._avatarFile = file;
  }

  async confirmAvatarUpload(): Promise<void> {
    const file: File | undefined = (this as any)._avatarFile;
    if (!file) {
      this.avatarUploadError = 'Selecciona una imagen primero.';
      return;
    }
    this.avatarUploading = true;
    this.avatarUploadError = null;
    const { publicUrl, error } = await this.auth.uploadAvatar(file);
    this.avatarUploading = false;
    if (error || !publicUrl) {
      this.avatarUploadError =
        error?.message || 'No se ha podido subir la imagen. Prueba con otro archivo.';
      return;
    }
    this.profileAvatarUrl = publicUrl;
    this.avatarError = false;
    this.closeAvatarModal();
  }

  private loadAccounts(): void {
    this.accountsLoading = true;
    this.accountsError = null;
    this.transactionService.getAccounts().subscribe({
      next: (res) => {
        const list = res?.data || [];
        this.accounts = list;
        this.accountDraftName = {};
        for (const acc of list) {
          this.accountDraftName[acc.id] = acc.display_name;
        }
        this.accountsLoading = false;
      },
      error: (err) => {
        console.error('[Layout] error loadAccounts', err);
        this.accountsError = err.error?.detail || 'Error al cargar cuentas';
        this.accountsLoading = false;
      }
    });
  }

  startEditAccount(acc: Account): void {
    this.editingAccountId = acc.id;
    if (!this.accountDraftName[acc.id]) {
      this.accountDraftName[acc.id] = acc.display_name;
    }
  }

  cancelEditAccount(acc: Account): void {
    this.accountDraftName[acc.id] = acc.display_name;
    if (this.editingAccountId === acc.id) {
      this.editingAccountId = null;
    }
  }

  saveAccountName(acc: Account): void {
    const draft = (this.accountDraftName[acc.id] || '').trim();
    if (!draft || draft === acc.display_name || this.savingAccountId === acc.id) {
      this.editingAccountId = null;
      return;
    }
    if (acc.shared) {
      this.renamePendingAccount = acc;
      this.renamePendingName = draft;
      this.renameSharedConfirmOpen = true;
      return;
    }
    this.performSaveAccountName(acc, draft);
  }

  confirmSaveSharedAccount(): void {
    const acc = this.renamePendingAccount;
    const name = this.renamePendingName.trim();
    this.renameSharedConfirmOpen = false;
    if (!acc || !acc.id || !name) return;
    this.performSaveAccountName(acc, name);
  }

  cancelSaveSharedAccount(): void {
    this.renameSharedConfirmOpen = false;
    this.renamePendingAccount = null;
    this.renamePendingName = '';
  }

  private performSaveAccountName(acc: Account, newName: string): void {
    this.savingAccountId = acc.id;
    this.transactionService.updateAccountName(acc.id, newName).subscribe({
      next: (res) => {
        acc.display_name = res.display_name || newName;
        this.accountDraftName[acc.id] = acc.display_name;
        this.savingAccountId = null;
        this.editingAccountId = null;
        this.renamePendingAccount = null;
        this.renamePendingName = '';
        this.transactionService.dataRefresh$.next();
      },
      error: (err) => {
        console.error('[Layout] error updateAccountName', err);
        this.accountsError = err.error?.detail || 'Error al guardar nombre de cuenta';
        this.savingAccountId = null;
      }
    });
  }

  async logout() {
    this.closeProfileMenu();
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
