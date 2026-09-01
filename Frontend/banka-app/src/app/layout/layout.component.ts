import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TransactionService, UploadResponse } from '../services/transaction.service';
import { AuthService } from '../services/auth.service';
import { Account } from '../models/transaction.model';
import { BackendLoaderComponent } from '../components/backend-loader/backend-loader.component';
import { BackendLoaderService } from '../services/backend-loader.service';
import { PrivacyService } from '../services/privacy.service';
import { ThemeService } from '../services/theme.service';

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, BackendLoaderComponent],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.scss'
})
export class LayoutComponent implements OnInit, OnDestroy {
  /** Orden: izquierda → centro → derecha: Resumen, Charts, Gastos (central), Compartidos, Ajustes */
  navItems = [
    { path: '/resumen', label: 'Resumen', icon: 'resumen' },
    { path: '/charts', label: 'Charts', icon: 'chart' },
    { path: '/gastos', label: 'Gastos', icon: 'receipt', center: true },
    { path: '/gastos-compartidos', label: 'Compartidos', icon: 'people' },
    { path: '/ajustes', label: 'Más', icon: 'settings', moreOps: true }
  ];
  moreOpsOpen = false;
  otherCategoryCount = 0;
  private destroy$ = new Subject<void>();

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
  profileNameModalOpen = false;

  // Modal avatar
  avatarModalOpen = false;
  avatarUploadFileName = '';
  avatarUploadError: string | null = null;
  avatarUploading = false;
  avatarPreviewUrl: string | null = null;
  avatarZoom = 1;
  private lastPinchDistance: number | null = null;

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
    private backendLoader: BackendLoaderService,
    public auth: AuthService,
    public privacy: PrivacyService,
    public theme: ThemeService
  ) {}

  ngOnInit(): void {
    this.transactionService.dataRefresh$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.refreshOtherCategoryCount());

    if (!this.transactionService.hasTransactionsCache()) {
      this.backendLoader.beginSplashLoad();
      this.transactionService.prefetchInitialData().subscribe({
        next: () => {
          this.backendLoader.endSplashLoad();
          this.refreshOtherCategoryCount();
        },
        error: () => this.backendLoader.endSplashLoad(),
      });
    } else {
      this.refreshOtherCategoryCount();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private refreshOtherCategoryCount(): void {
    this.transactionService.countOtherCategoryTransactions().subscribe({
      next: (n) => {
        this.otherCategoryCount = n;
      },
    });
  }

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

  openProfileNameModal(event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
    }
    if (!this.profileName) {
      this.ensureProfileLoaded();
    }
    this.profileNameModalOpen = true;
  }

  closeProfileNameModal(): void {
    this.profileNameModalOpen = false;
  }

  openAvatarModal(): void {
    this.avatarUploadError = null;
    this.avatarUploadFileName = this.avatarUrl ? 'Foto actual' : '';
    this.avatarZoom = 1;
    this.avatarPreviewUrl = this.avatarUrl;
    this.avatarModalOpen = true;
  }

  closeAvatarModal(): void {
    this.avatarModalOpen = false;
    this.lastPinchDistance = null;
    if (this.avatarPreviewUrl && this.avatarPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.avatarPreviewUrl);
    }
    this.avatarPreviewUrl = null;
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

  toggleMoreOpsMenu(): void {
    this.moreOpsOpen = !this.moreOpsOpen;
  }

  closeMoreOpsMenu(): void {
    this.moreOpsOpen = false;
  }

  goToMoreOperation(path: string): void {
    this.moreOpsOpen = false;
    void this.router.navigateByUrl(path);
  }

  isMoreOperationsActive(): boolean {
    const url = this.router.url || '';
    return (
      url.startsWith('/ajustes') ||
      url.startsWith('/inversion') ||
      url.startsWith('/hipotecas') ||
      url.startsWith('/salario') ||
      url.startsWith('/pagos-recurrentes')
    );
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

  onAvatarPreviewWheel(event: WheelEvent): void {
    event.preventDefault();
    const delta = event.deltaY;
    const step = 0.1;
    if (delta < 0) {
      this.avatarZoom = Math.min(3, this.avatarZoom + step);
    } else if (delta > 0) {
      this.avatarZoom = Math.max(1, this.avatarZoom - step);
    }
  }

  onAvatarPreviewTouchStart(event: TouchEvent): void {
    if (event.touches.length === 2) {
      const [t1, t2] = [event.touches[0], event.touches[1]];
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      this.lastPinchDistance = Math.hypot(dx, dy);
    }
  }

  onAvatarPreviewTouchMove(event: TouchEvent): void {
    if (event.touches.length === 2 && this.lastPinchDistance) {
      event.preventDefault();
      const [t1, t2] = [event.touches[0], event.touches[1]];
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      const dist = Math.hypot(dx, dy);
      const delta = dist - this.lastPinchDistance;
      const factor = 1 + delta / 200; // sensibilidad
      this.avatarZoom = Math.max(1, Math.min(3, this.avatarZoom * factor));
      this.lastPinchDistance = dist;
    }
  }

  onAvatarPreviewTouchEnd(event: TouchEvent): void {
    if (event.touches.length < 2) {
      this.lastPinchDistance = null;
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
    if (this.avatarPreviewUrl && this.avatarPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.avatarPreviewUrl);
    }
    this.avatarPreviewUrl = URL.createObjectURL(file);
  }

  async confirmAvatarUpload(): Promise<void> {
    if (!this.avatarPreviewUrl) {
      this.avatarUploadError = 'Selecciona una imagen o usa una foto existente.';
      return;
    }
    this.avatarUploading = true;
    this.avatarUploadError = null;
    try {
      const zoom = Math.max(1, Math.min(this.avatarZoom || 1, 3));
      const img = new Image();
      img.src = this.avatarPreviewUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('No se ha podido cargar la imagen para recorte.'));
      });
      const iw = img.width;
      const ih = img.height;
      const baseSide = Math.min(iw, ih) / zoom;
      const sx = (iw - baseSide) / 2;
      const sy = (ih - baseSide) / 2;
      const canvas = document.createElement('canvas');
      const size = 256;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('No se ha podido inicializar el contexto de dibujo.');
      }
      ctx.drawImage(img, sx, sy, baseSide, baseSide, 0, 0, size, size);
      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se ha podido generar la imagen recortada.'))), 'image/webp');
      });
      const { publicUrl, error } = await this.auth.uploadAvatar(blob, this.avatarUploadFileName || 'avatar.webp');
      if (error || !publicUrl) {
        this.avatarUploadError =
          error?.message || 'No se ha podido subir la imagen. Prueba con otro archivo.';
        return;
      }
      this.profileAvatarUrl = publicUrl;
      this.avatarError = false;
      this.closeAvatarModal();
    } catch (e: any) {
      this.avatarUploadError = e?.message || 'Error al procesar la imagen.';
    } finally {
      this.avatarUploading = false;
    }
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

  logout() {
    this.closeProfileMenu();
    this.transactionService.clearTransactionsCache();
    this.auth.signOut();
    void this.router.navigateByUrl('/login', { replaceUrl: true });
  }

  async toggleTheme(): Promise<void> {
    await this.theme.toggleTheme();
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
