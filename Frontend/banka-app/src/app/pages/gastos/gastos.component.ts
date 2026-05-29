import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone, ChangeDetectionStrategy } from '@angular/core';
import { trigger, transition, style, animate } from '@angular/animations';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { Transaction } from '../../models/transaction.model';
import { getTransactionIconInfo } from '../../utils/transaction-icons';
import { PrivacyService } from '../../services/privacy.service';
import { ThemeService } from '../../services/theme.service';

type DatePreset = 'month' | '30d' | '3m' | 'year' | 'custom';

@Component({
  selector: 'app-gastos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  templateUrl: './gastos.component.html',
  styleUrl: './gastos.component.scss',
  animations: [
    trigger('loaderOverlay', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('200ms ease-out', style({ opacity: 1 }))
      ]),
      transition(':leave', [
        animate('180ms ease-in', style({ opacity: 0 }))
      ])
    ])
  ]
})
export class GastosComponent implements OnInit, OnDestroy {
  balances: Record<string, number> = {};
  transactions: Transaction[] = [];
  loading = false;
  showLoader = false;
  loadingBalances = false;
  error: string | null = null;

  currentPage = 1;
  pageSize = 500;
  totalCount = 0;

  fromDate = '';
  toDate = '';
  activePreset: DatePreset | null = 'month';
  customFrom = '';
  customTo = '';
  showCalendar = false;
  private destroy$ = new Subject<void>();
  private iconInfoCache = new Map<number, ReturnType<typeof getTransactionIconInfo>>();
  private derivedDisplayedTransactions: Transaction[] = [];
  private derivedTransactionsByDate: { date: string; dateLabel: string; transactions: Transaction[] }[] = [];
  private derivedDisplayedCount = 0;
  private derivedTransactionsForBalances: Transaction[] = [];
  private derivedTotalGastos = 0;
  private derivedTotalIngresos = 0;
  private derivedTotalBalance = 0;
  private derivedPerAccountStats = new Map<string, { gastos: number; ingresos: number; balance: number }>();

  readonly presets: { id: DatePreset; label: string }[] = [
    { id: 'month', label: 'Mes en curso' },
    { id: '30d', label: '30 días' },
    { id: '3m', label: '3 meses' },
    { id: 'year', label: 'Año' },
    { id: 'custom', label: 'Personalizado' }
  ];

  constructor(
    private transactionService: TransactionService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    public privacy: PrivacyService,
    public theme: ThemeService
  ) {}

  ngOnInit() {
    this.loadBalances();
    this.applyPreset('month');
    this.transactionService.dataRefresh$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.loadBalances();
        this.loadTransactions();
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadBalances() {
    this.loadingBalances = true;
    this.transactionService.getBalances().subscribe({
      next: (res) => {
        this.ngZone.run(() => {
          if (res?.success && res?.data) this.balances = { ...res.data };
          this.loadingBalances = false;
          this.cdr.detectChanges();
        });
      },
      error: () => {
        this.ngZone.run(() => {
          this.loadingBalances = false;
          this.cdr.detectChanges();
        });
      }
    });
  }

  loadTransactions() {
    this.loading = true;
    this.showLoader = true;
    this.error = null;

    this.transactionService.getTransactions({
      from_date: this.fromDate || undefined,
      to_date: this.toDate || undefined,
      limit: this.pageSize,
      offset: (this.currentPage - 1) * this.pageSize
    }).subscribe({
      next: (res) => {
        const raw = res?.data;
        const arr = Array.isArray(raw) ? raw : (Array.isArray((raw as any)?.data) ? (raw as any).data : []);
        const mapped = arr.map((t: any) => ({
          id: t.id,
          transaction_id: t.transaction_id,
          dt_date: t.dt_date || t.transaction_date || '',
          importe: typeof t.importe === 'number' ? t.importe : parseFloat(t.importe) || 0,
          saldo: t.saldo != null ? (typeof t.saldo === 'number' ? t.saldo : parseFloat(t.saldo)) : undefined,
          cuenta: t.cuenta || t.account_number,
          descripcion: t.descripcion || t.description || '',
          categoria: t.categoria || t.category,
          subcategoria: t.subcategoria,
          es_transferencia_interna: t.es_transferencia_interna === true
        }));
        this.ngZone.run(() => {
          this.transactions = mapped;
          this.totalCount = res?.count ?? mapped.length;
          this.recomputeDerivedData();
          this.loading = false;
          this.showLoader = false;
          this.cdr.detectChanges();
        });
      },
      error: (err) => {
        this.ngZone.run(() => {
          console.error('[Gastos] transactions error:', err);
          this.error = err.error?.detail || 'Error al cargar. ¿Backend conectado?';
          this.loading = false;
          this.showLoader = false;
          this.cdr.detectChanges();
        });
      }
    });
  }

  applyPreset(preset: DatePreset) {
    if (preset === 'custom') {
      this.showCalendar = true;
      this.customFrom = this.fromDate || this.formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
      this.customTo = this.toDate || this.formatDate(new Date());
      return;
    }
    this.showCalendar = false;
    this.activePreset = preset;
    const now = new Date();

    switch (preset) {
      case 'month':
        this.fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        this.toDate = this.formatDate(now);
        break;
      case '30d':
        const d30 = new Date(now);
        d30.setDate(d30.getDate() - 30);
        this.fromDate = this.formatDate(d30);
        this.toDate = this.formatDate(now);
        break;
      case '3m':
        const m3 = new Date(now);
        m3.setMonth(m3.getMonth() - 3);
        this.fromDate = this.formatDate(m3);
        this.toDate = this.formatDate(now);
        break;
      case 'year':
        this.fromDate = `${now.getFullYear()}-01-01`;
        this.toDate = this.formatDate(now);
        break;
    }

    this.currentPage = 1;
    this.loadTransactions();
  }

  applyCustomRange() {
    this.fromDate = this.customFrom;
    this.toDate = this.customTo;
    this.activePreset = 'custom';
    this.showCalendar = false;
    this.currentPage = 1;
    this.loadTransactions();
  }

  closeCalendar() {
    this.showCalendar = false;
  }

  formatDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  formatDisplayDate(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  }

  getIconInfo(t: Transaction) {
    const key = Number(t.id ?? 0);
    const hit = this.iconInfoCache.get(key);
    if (hit) return hit;
    const info = getTransactionIconInfo(t);
    this.iconInfoCache.set(key, info);
    return info;
  }

  getIconColor(t: Transaction): string {
    if (this.theme.isDark()) return '#ffffff';
    return this.getIconInfo(t).color || '#6b7280';
  }

  getIconBackgroundColor(t: Transaction): string {
    const info = this.getIconInfo(t);
    if (info.isLogo) return '#ffffff';
    return `${info.color || '#f3f4f6'}40`;
  }

  /** Fallback local si falta un icono (ej. no se ejecutó download-all-icons) */
  onIconError(ev: Event) {
    const img = ev.target as HTMLImageElement;
    if (img && !img.src.endsWith('/icons/default.svg')) img.src = '/icons/default.svg';
  }

  get displayedTransactions(): Transaction[] {
    return this.derivedDisplayedTransactions;
  }

  /** Transacciones para calcular gastos/ingresos/saldo del periodo = solo rango de fechas, sin transferencias internas */
  get transactionsForBalances(): Transaction[] {
    return this.derivedTransactionsForBalances;
  }

  /** Agrupado por fecha. Orden viene del API (dt_date desc). */
  get transactionsByDate(): { date: string; dateLabel: string; transactions: Transaction[] }[] {
    return this.derivedTransactionsByDate;
  }

  getAccountLabel(cuenta?: string): string {
    return cuenta || '';
  }

  previousPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.loadTransactions();
    }
  }

  nextPage() {
    this.currentPage++;
    this.loadTransactions();
  }

  retry() {
    this.loadBalances();
    this.loadTransactions();
  }

  get totalPages(): number {
    return Math.ceil(this.totalCount / this.pageSize) || 1;
  }

  get balanceEntries(): [string, number][] {
    const order = ['Revolut', 'Personal', 'Conjunta', 'Pluxee'];
    const entries = Object.entries(this.balances);
    return entries.sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  }

  gastosByAccount(cuenta: string): number {
    return this.derivedPerAccountStats.get(cuenta)?.gastos ?? 0;
  }

  ingresosByAccount(cuenta: string): number {
    return this.derivedPerAccountStats.get(cuenta)?.ingresos ?? 0;
  }

  balanceByAccount(cuenta: string): number {
    return this.derivedPerAccountStats.get(cuenta)?.balance ?? 0;
  }

  get totalGastos(): number {
    return this.derivedTotalGastos;
  }

  get totalIngresos(): number {
    return this.derivedTotalIngresos;
  }

  get totalBalance(): number {
    return this.derivedTotalBalance;
  }

  get displayedCount(): number {
    return this.derivedDisplayedCount;
  }

  private recomputeDerivedData(): void {
    this.iconInfoCache.clear();
    const txRange = this.transactions;
    this.derivedDisplayedTransactions = txRange.filter(t => (t.categoria || '') !== 'Compra_Inmueble');
    this.derivedDisplayedCount = this.derivedDisplayedTransactions.length;

    const grouped = new Map<string, Transaction[]>();
    for (const t of this.derivedDisplayedTransactions) {
      const d = (t.dt_date || '').slice(0, 10);
      if (!d) continue;
      if (!grouped.has(d)) grouped.set(d, []);
      grouped.get(d)!.push(t);
    }
    this.derivedTransactionsByDate = Array.from(grouped.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, transactions]) => ({ date, dateLabel: this.formatDisplayDate(date), transactions }));

    this.derivedTransactionsForBalances = txRange.filter(t => !t.es_transferencia_interna);
    this.derivedPerAccountStats = new Map<string, { gastos: number; ingresos: number; balance: number }>();
    let gastos = 0;
    let ingresos = 0;
    let balance = 0;
    for (const t of this.derivedTransactionsForBalances) {
      const cuenta = (t.cuenta || '').toString();
      if (!this.derivedPerAccountStats.has(cuenta)) {
        this.derivedPerAccountStats.set(cuenta, { gastos: 0, ingresos: 0, balance: 0 });
      }
      const st = this.derivedPerAccountStats.get(cuenta)!;
      const imp = t.importe || 0;
      st.balance += imp;
      balance += imp;
      if (imp < 0 && (t.categoria || '') !== 'Transferencia') {
        st.gastos += imp;
        gastos += imp;
      } else if (imp > 0) {
        st.ingresos += imp;
        ingresos += imp;
      }
    }
    this.derivedTotalGastos = gastos;
    this.derivedTotalIngresos = ingresos;
    this.derivedTotalBalance = balance;
  }
}
