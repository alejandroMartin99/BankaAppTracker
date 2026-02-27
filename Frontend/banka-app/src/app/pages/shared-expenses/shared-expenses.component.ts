import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core';
import { trigger, transition, style, animate } from '@angular/animations';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { Transaction } from '../../models/transaction.model';
import { getTransactionIconInfo } from '../../utils/transaction-icons';

type DatePreset = 'all' | 'month' | '30d' | '3m' | 'year' | 'custom';

interface SubcategorySummary {
  subcategoria: string;
  total: number;
  transactions: Transaction[];
}

interface CategorySummary {
  categoria: string;
  total: number;
  subcategories: SubcategorySummary[];
}

function makeSubKey(cat: string, sub: string): string {
  return `${cat || 'Sin categoría'}|${sub || 'Sin subcategoría'}`;
}

@Component({
  selector: 'app-shared-expenses',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './shared-expenses.component.html',
  styleUrl: './shared-expenses.component.scss',
  animations: [
    trigger('loaderOverlay', [
      transition(':enter', [style({ opacity: 0 }), animate('200ms ease-out', style({ opacity: 1 }))]),
      transition(':leave', [animate('180ms ease-in', style({ opacity: 0 }))])
    ])
  ]
})
export class SharedExpensesComponent implements OnInit, OnDestroy {
  transactions: Transaction[] = [];
  loading = false;
  error: string | null = null;

  fromDate = '';
  toDate = '';
  activePreset: DatePreset | null = 'all';
  customFrom = '';
  customTo = '';
  showCalendar = false;
  expandedCategory: string | null = null;
  expandedSubcategoryKey: string | null = null;
  private destroy$ = new Subject<void>();

  readonly presets: { id: DatePreset; label: string }[] = [
    { id: 'all', label: 'Histórico' },
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
    // Por defecto: histórico completo (sin filtro de fechas) usando preset "Histórico"
    this.applyPreset('all');
    this.transactionService.dataRefresh$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadTransactions());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadTransactions() {
    this.loading = true;
    this.error = null;
    this.transactionService.getSharedTransactions({
      from_date: this.fromDate || undefined,
      to_date: this.toDate || undefined
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
          categoria: (t.categoria ?? t.category ?? t.Categoria ?? '').toString().trim(),
          subcategoria: t.subcategoria ?? t.Subcategoria,
          is_own_account: t.is_own_account === true
        }));
        this.ngZone.run(() => {
          this.transactions = mapped;
          this.loading = false;
          this.cdr.detectChanges();
        });
      },
      error: (err) => {
        console.error('[SharedExpenses] error:', err);
        this.error = err.error?.detail || 'Error al cargar. ¿Backend conectado?';
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
      case 'all':
        this.fromDate = '';
        this.toDate = '';
        break;
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
    this.loadTransactions();
  }

  applyCustomRange() {
    this.fromDate = this.customFrom;
    this.toDate = this.customTo;
    this.activePreset = 'custom';
    this.showCalendar = false;
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

  onIconError(ev: Event) {
    const img = ev.target as HTMLImageElement;
    if (img && !img.src.endsWith('/icons/default.svg')) img.src = '/icons/default.svg';
  }

  /** Transacciones relevantes: Suministros (todos) + Gimnasio solo si gasto > 20 € */
  private get filteredForSummary(): Transaction[] {
    return this.transactions.filter(t => {
      const importe = t.importe ?? 0;
      if (importe >= 0) return false; // solo gastos
      const cat = String(t.categoria ?? '').trim().toLowerCase();
      const sub = String(t.subcategoria ?? '').trim().toLowerCase();
      const isSuministros = cat === 'suministros';
      const isGimnasio = sub === 'gimnasio';
      if (isSuministros) return true;
      if (isGimnasio) return Math.abs(importe) > 20; // Gimnasio: solo > 20 €
      return false;
    });
  }

  get displayedTransactions(): Transaction[] {
    return this.filteredForSummary;
  }

  /** Agrupado por categoría y subcategoría (mismo display que Resumen) */
  get categoriesSummary(): CategorySummary[] {
    const byCat = new Map<string, Map<string, Transaction[]>>();
    for (const t of this.displayedTransactions) {
      const cat = t.categoria || 'Sin categoría';
      const sub = t.subcategoria || 'Sin subcategoría';
      if (!byCat.has(cat)) byCat.set(cat, new Map());
      const subMap = byCat.get(cat)!;
      if (!subMap.has(sub)) subMap.set(sub, []);
      subMap.get(sub)!.push(t);
    }
    return Array.from(byCat.entries()).map(([categoria, subMap]) => {
      const subcategories: SubcategorySummary[] = Array.from(subMap.entries()).map(([subcategoria, transactions]) => ({
        subcategoria,
        total: transactions.reduce((s, tx) => s + (tx.importe || 0), 0),
        transactions: transactions.sort((a, b) => (b.dt_date || '').localeCompare(a.dt_date || ''))
      }));
      return {
        categoria,
        total: subcategories.reduce((s, sc) => s + sc.total, 0),
        subcategories: subcategories.sort((a, b) => a.total - b.total)
      };
    }).sort((a, b) => a.total - b.total);
  }

  /** Total que has pagado tú (todos los gastos del filtro) */
  get totalMine(): number {
    return this.filteredForSummary
      .filter(t => t.is_own_account && (t.cuenta || '').toLowerCase() !== 'conjunta')
      .reduce((sum, t) => sum + Math.abs(t.importe ?? 0), 0);
  }

  /** Total que ha pagado la otra persona */
  get totalOther(): number {
    return this.filteredForSummary
      .filter(t => !t.is_own_account)
      .reduce((sum, t) => sum + Math.abs(t.importe ?? 0), 0);
  }

  get sharedTotal(): number {
    return this.totalMine + this.totalOther;
  }

  /** Total cargado en la cuenta Conjunta (pago de los dos) */
  get totalJoint(): number {
    return this.filteredForSummary
      .filter(t => (t.cuenta || '').toLowerCase() === 'conjunta')
      .reduce((sum, t) => sum + Math.abs(t.importe ?? 0), 0);
  }

  /** Transacciones no Conjunta (Conjunta = pago de los dos, no entra en quién debe a quién) */
  private get filteredNoConjunta(): Transaction[] {
    return this.filteredForSummary.filter(t => (t.cuenta || '').toLowerCase() !== 'conjunta');
  }

  /** Tuyo excluyendo Conjunta, para el saldo */
  get totalMineNoConjunta(): number {
    return this.filteredNoConjunta
      .filter(t => t.is_own_account)
      .reduce((sum, t) => sum + Math.abs(t.importe ?? 0), 0);
  }

  /** Del otro excluyendo Conjunta, para el saldo */
  get totalOtherNoConjunta(): number {
    return this.filteredNoConjunta
      .filter(t => !t.is_own_account)
      .reduce((sum, t) => sum + Math.abs(t.importe ?? 0), 0);
  }

  /**
   * Saldo a tu favor (50/50) solo con cuentas no Conjunta.
   * Conjunta = pago de ambos, no cuenta para quién debe a quién.
   * > 0: te deben. < 0: debes. 0: estáis en paz.
   */
  get settlementAmount(): number {
    const total = this.totalMineNoConjunta + this.totalOtherNoConjunta;
    if (total === 0) return 0;
    const idealPorPersona = total / 2;
    const mine = this.totalMineNoConjunta;
    return +(mine - idealPorPersona).toFixed(2);
  }

  getAccountLabelShort(cuenta?: string): string {
    if (!cuenta) return '';
    if (cuenta === 'Revolut') return 'Revolut';
    if (cuenta === 'Personal') return 'Personal';
    if (cuenta === 'Conjunta') return 'Conjunta';
    if (cuenta === 'Pluxee') return 'Pluxee';
    return cuenta.length > 6 ? cuenta.slice(0, 5) + '.' : cuenta;
  }

  getAccountLabel(cuenta?: string): string {
    if (!cuenta) return '';
    if (cuenta === 'Revolut') return 'Revolut';
    if (cuenta === 'Personal') return 'Ibercaja Personal';
    if (cuenta === 'Conjunta') return 'Ibercaja Conjunta';
    if (cuenta === 'Pluxee') return 'Pluxee';
    return cuenta;
  }

  toggleCategory(categoria: string) {
    this.expandedCategory = this.expandedCategory === categoria ? null : categoria;
  }

  toggleSubcategory(categoria: string, subcategoria: string) {
    const key = makeSubKey(categoria, subcategoria);
    this.expandedSubcategoryKey = this.expandedSubcategoryKey === key ? null : key;
  }

  isSubcategoryExpanded(categoria: string, subcategoria: string): boolean {
    return this.expandedSubcategoryKey === makeSubKey(categoria, subcategoria);
  }

  retry() {
    this.loadTransactions();
  }
}
