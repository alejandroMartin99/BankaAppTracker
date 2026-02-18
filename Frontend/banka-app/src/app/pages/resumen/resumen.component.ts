import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TransactionService } from '../../services/transaction.service';
import { Transaction } from '../../models/transaction.model';

type DatePreset = 'month' | '30d' | '3m' | 'year' | 'custom';

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
  selector: 'app-resumen',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './resumen.component.html',
  styleUrl: './resumen.component.scss'
})
export class ResumenComponent implements OnInit, OnDestroy {
  transactions: Transaction[] = [];
  loading = false;
  error: string | null = null;

  fromDate = '';
  toDate = '';
  activePreset: DatePreset | null = 'month';
  customFrom = '';
  customTo = '';
  showCalendar = false;
  expandedCategory: string | null = null;
  expandedSubcategoryKey: string | null = null;
  expandedIncomeCategory: string | null = null;
  expandedIncomeSubcategoryKey: string | null = null;
  selectedAccount: string = '';
  private destroy$ = new Subject<void>();

  readonly accountFilters: { id: string; label: string }[] = [
    { id: '', label: 'Todas' },
    { id: 'Revolut', label: 'Revolut' },
    { id: 'Personal', label: 'Personal' },
    { id: 'Conjunta', label: 'Conjunta' },
    { id: 'Pluxee', label: 'Pluxee' }
  ];

  readonly presets: { id: DatePreset; label: string }[] = [
    { id: 'month', label: 'Mes en curso' },
    { id: '30d', label: '30 días' },
    { id: '3m', label: '3 meses' },
    { id: 'year', label: 'Año' },
    { id: 'custom', label: 'Personalizado' }
  ];

  constructor(private transactionService: TransactionService) {}

  ngOnInit() {
    this.applyPreset('month');
    this.transactionService.dataRefresh$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadTransactions());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Transacciones filtradas: incluir todas */
  get filteredTransactions(): Transaction[] {
    let list = [...this.transactions];
    if (this.selectedAccount) {
      list = list.filter(t => (t.cuenta || '') === this.selectedAccount);
    }
    return list;
  }

  /** Suma de los totales de cada categoría en "Gastos por categoría" */
  get totalGastos(): number {
    return this.categoriesSummary.reduce((sum, cat) => sum + cat.total, 0);
  }

  /** Suma de los totales de cada categoría en "Ingresos por categoría" */
  get totalIngresos(): number {
    return this.incomesSummary.reduce((sum, cat) => sum + cat.total, 0);
  }

  /** Balance = Ingresos + Gastos (coherente con los totales mostrados; excluye transferencias internas) */
  get totalBalance(): number {
    return this.totalIngresos + this.totalGastos;
  }

  get incomesSummary(): CategorySummary[] {
    const byCat = new Map<string, Map<string, Transaction[]>>();
    for (const t of this.filteredTransactions) {
      if ((t.importe || 0) <= 0) continue;
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
        subcategories: subcategories.sort((a, b) => b.total - a.total)
      };
    }).sort((a, b) => b.total - a.total);
  }

  get categoriesSummary(): CategorySummary[] {
    const byCat = new Map<string, Map<string, Transaction[]>>();
    for (const t of this.filteredTransactions) {
      if ((t.importe || 0) >= 0 || (t.categoria || '') === 'Transferencia') continue;
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

  loadTransactions() {
    this.loading = true;
    this.error = null;
    this.transactionService.getTransactions({
      from_date: this.fromDate || undefined,
      to_date: this.toDate || undefined,
      limit: 1000,
      offset: 0
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
          subcategoria: t.subcategoria
        }));
        this.transactions = mapped;
        this.loading = false;
      },
      error: (err) => {
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

  toggleCategory(categoria: string) {
    this.expandedCategory = this.expandedCategory === categoria ? null : categoria;
  }

  toggleSubcategory(categoria: string, subcategoria: string) {
    const key = makeSubKey(categoria, subcategoria);
    this.expandedSubcategoryKey = this.expandedSubcategoryKey === key ? null : key;
  }

  toggleIncomeCategory(categoria: string) {
    this.expandedIncomeCategory = this.expandedIncomeCategory === categoria ? null : categoria;
  }

  toggleIncomeSubcategory(categoria: string, subcategoria: string) {
    const key = makeSubKey(categoria, subcategoria);
    this.expandedIncomeSubcategoryKey = this.expandedIncomeSubcategoryKey === key ? null : key;
  }

  isSubcategoryExpanded(categoria: string, subcategoria: string): boolean {
    return this.expandedSubcategoryKey === makeSubKey(categoria, subcategoria);
  }

  isIncomeSubcategoryExpanded(categoria: string, subcategoria: string): boolean {
    return this.expandedIncomeSubcategoryKey === makeSubKey(categoria, subcategoria);
  }

  formatDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  formatDisplayDate(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  }

  selectAccount(accountId: string) {
    this.selectedAccount = accountId;
  }

  getAccountLabel(cuenta?: string): string {
    if (!cuenta) return '';
    if (cuenta === 'Revolut') return 'Revolut';
    if (cuenta === 'Personal') return 'Ibercaja Personal';
    if (cuenta === 'Conjunta') return 'Ibercaja Conjunta';
    if (cuenta === 'Pluxee') return 'Pluxee';
    return cuenta;
  }
}
