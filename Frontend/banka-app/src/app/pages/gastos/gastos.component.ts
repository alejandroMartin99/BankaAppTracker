import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { Transaction } from '../../models/transaction.model';
import { getTransactionIconInfo } from '../../utils/transaction-icons';

type DatePreset = 'month' | '30d' | '3m' | 'year' | 'custom';

@Component({
  selector: 'app-gastos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './gastos.component.html',
  styleUrl: './gastos.component.scss'
})
export class GastosComponent implements OnInit, OnDestroy {
  balances: Record<string, number> = {};
  transactions: Transaction[] = [];
  loading = false;
  loadingBalances = false;
  error: string | null = null;

  currentPage = 1;
  pageSize = 500;
  totalCount = 0;

  fromDate = '';
  toDate = '';
  activePreset: DatePreset | null = '30d';
  customFrom = '';
  customTo = '';
  showCalendar = false;
  showInternalTransfers = true;
  private destroy$ = new Subject<void>();

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
    private ngZone: NgZone
  ) {}

  ngOnInit() {
    this.loadBalances();
    this.applyPreset('30d');
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
        if (res?.success && res?.data) this.balances = { ...res.data };
        this.loadingBalances = false;
      },
      error: () => { this.loadingBalances = false; }
    });
  }

  loadTransactions() {
    this.loading = true;
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
          es_transferencia_interna: !!t.es_transferencia_interna
        }));
        this.ngZone.run(() => {
          this.transactions = mapped;
          this.totalCount = res?.count ?? mapped.length;
          this.loading = false;
          this.cdr.detectChanges();
        });
      },
      error: (err) => {
        console.error('[Gastos] transactions error:', err);
        this.error = err.error?.detail || 'Error al cargar. ¿Backend en http://localhost:8000?';
        this.loading = false;
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
    return getTransactionIconInfo(t);
  }

  /** Fallback local si falta un icono (ej. no se ejecutó download-all-icons) */
  onIconError(ev: Event) {
    const img = ev.target as HTMLImageElement;
    if (img && !img.src.endsWith('/icons/default.svg')) img.src = '/icons/default.svg';
  }

  /** Movimientos sin Compra_Inmueble ni transferencias internas (para lista principal) */
  get displayedTransactions(): Transaction[] {
    return this.transactions.filter(t =>
      (t.categoria || '') !== 'Compra_Inmueble' && !t.es_transferencia_interna
    );
  }

  /** Transacciones para calcular balances: excluir Compra_Inmueble y transferencias internas */
  get transactionsForBalances(): Transaction[] {
    return this.transactions.filter(t =>
      (t.categoria || '') !== 'Compra_Inmueble' && !t.es_transferencia_interna
    );
  }

  /** Transferencias internas entre cuentas propias (se muestran en apartado aparte) */
  get internalTransfers(): Transaction[] {
    return this.transactions.filter(t =>
      (t.categoria || '') !== 'Compra_Inmueble' && !!t.es_transferencia_interna
    );
  }

  /** Agrupado por fecha para bloques con cabecera de día */
  get transactionsByDate(): { date: string; dateLabel: string; transactions: Transaction[] }[] {
    const grouped = new Map<string, Transaction[]>();
    for (const t of this.displayedTransactions) {
      const d = t.dt_date || '';
      if (!grouped.has(d)) grouped.set(d, []);
      grouped.get(d)!.push(t);
    }
    return Array.from(grouped.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, transactions]) => ({
        date,
        dateLabel: this.formatDisplayDate(date),
        transactions
      }));
  }

  getAccountLabel(cuenta?: string): string {
    if (!cuenta) return '';
    if (cuenta === 'Revolut') return 'Revolut';
    if (cuenta === 'Personal') return 'Ibercaja Personal';
    if (cuenta === 'Conjunta') return 'Ibercaja Conjunta';
    return cuenta;
  }

  /** Versión corta para balance cards en móvil */
  getAccountLabelShort(cuenta?: string): string {
    if (!cuenta) return '';
    if (cuenta === 'Revolut') return 'Revolut';
    if (cuenta === 'Personal') return 'Personal';
    if (cuenta === 'Conjunta') return 'Conjunta';
    return cuenta.length > 6 ? cuenta.slice(0, 5) + '.' : cuenta;
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
    const order = ['Revolut', 'Personal', 'Conjunta'];
    const entries = Object.entries(this.balances);
    return entries.sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  }

  gastosByAccount(cuenta: string): number {
    return this.transactionsForBalances
      .filter(t => (t.cuenta || '') === cuenta && (t.importe || 0) < 0)
      .reduce((sum, t) => sum + (t.importe || 0), 0);
  }

  ingresosByAccount(cuenta: string): number {
    return this.transactionsForBalances
      .filter(t => (t.cuenta || '') === cuenta && (t.importe || 0) > 0)
      .reduce((sum, t) => sum + (t.importe || 0), 0);
  }

  balanceByAccount(cuenta: string): number {
    return this.transactionsForBalances
      .filter(t => (t.cuenta || '') === cuenta)
      .reduce((sum, t) => sum + (t.importe || 0), 0);
  }

  get totalGastos(): number {
    return this.transactionsForBalances
      .filter(t => (t.importe || 0) < 0)
      .reduce((sum, t) => sum + (t.importe || 0), 0);
  }

  get totalIngresos(): number {
    return this.transactionsForBalances
      .filter(t => (t.importe || 0) > 0)
      .reduce((sum, t) => sum + (t.importe || 0), 0);
  }

  get totalBalance(): number {
    return this.transactionsForBalances.reduce((sum, t) => sum + (t.importe || 0), 0);
  }

  /** Transferencias internas agrupadas por fecha (para sección dedicada) */
  get internalTransfersByDate(): { date: string; dateLabel: string; transactions: Transaction[] }[] {
    const grouped = new Map<string, Transaction[]>();
    for (const t of this.internalTransfers) {
      const d = t.dt_date || '';
      if (!grouped.has(d)) grouped.set(d, []);
      grouped.get(d)!.push(t);
    }
    return Array.from(grouped.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, transactions]) => ({
        date,
        dateLabel: this.formatDisplayDate(date),
        transactions
      }));
  }

  get displayedCount(): number {
    return this.displayedTransactions.length;
  }
}
