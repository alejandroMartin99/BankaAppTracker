import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TransactionService } from '../../services/transaction.service';
import { Transaction } from '../../models/transaction.model';

type DatePreset = 'month' | '30d' | '3m' | 'year' | 'custom';

interface CategorySummary {
  categoria: string;
  total: number;
  transactions: Transaction[];
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
  activePreset: DatePreset | null = '30d';
  customFrom = '';
  customTo = '';
  showCalendar = false;
  expandedCategory: string | null = null;
  expandedIncomeCategory: string | null = null;
  selectedAccount: string = '';
  private destroy$ = new Subject<void>();

  readonly accountFilters: { id: string; label: string }[] = [
    { id: '', label: 'Todas' },
    { id: 'Revolut', label: 'Revolut' },
    { id: 'Personal', label: 'Personal' },
    { id: 'Conjunta', label: 'Conjunta' }
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
    this.applyPreset('30d');
    this.transactionService.dataRefresh$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadTransactions());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Transacciones filtradas: excluir Compra_Inmueble y transferencias internas (para balances y resúmenes) */
  get filteredTransactions(): Transaction[] {
    let list = this.transactions.filter(t =>
      (t.categoria || '') !== 'Compra_Inmueble' && !t.es_transferencia_interna
    );
    if (this.selectedAccount) {
      list = list.filter(t => (t.cuenta || '') === this.selectedAccount);
    }
    return list;
  }

  get totalGastos(): number {
    return this.filteredTransactions
      .filter(t => (t.importe || 0) < 0)
      .reduce((sum, t) => sum + (t.importe || 0), 0);
  }

  get totalIngresos(): number {
    return this.filteredTransactions
      .filter(t => (t.importe || 0) > 0)
      .reduce((sum, t) => sum + (t.importe || 0), 0);
  }

  get totalBalance(): number {
    return this.filteredTransactions.reduce((sum, t) => sum + (t.importe || 0), 0);
  }

  get incomesSummary(): CategorySummary[] {
    const byCat = new Map<string, Transaction[]>();
    for (const t of this.filteredTransactions) {
      if ((t.importe || 0) <= 0) continue;
      const cat = t.categoria || 'Sin categoría';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(t);
    }
    return Array.from(byCat.entries())
      .map(([categoria, transactions]) => ({
        categoria,
        total: transactions.reduce((s, t) => s + (t.importe || 0), 0),
        transactions: transactions.sort((a, b) => (b.dt_date || '').localeCompare(a.dt_date || ''))
      }))
      .sort((a, b) => b.total - a.total);
  }

  get categoriesSummary(): CategorySummary[] {
    const byCat = new Map<string, Transaction[]>();
    for (const t of this.filteredTransactions) {
      if ((t.importe || 0) >= 0) continue;
      const cat = t.categoria || 'Sin categoría';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(t);
    }
    return Array.from(byCat.entries())
      .map(([categoria, transactions]) => ({
        categoria,
        total: transactions.reduce((s, t) => s + (t.importe || 0), 0),
        transactions: transactions.sort((a, b) => (b.dt_date || '').localeCompare(a.dt_date || ''))
      }))
      .sort((a, b) => a.total - b.total);
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
        this.transactions = arr.map((t: any) => ({
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
        this.loading = false;
      },
      error: (err) => {
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

  toggleIncomeCategory(categoria: string) {
    this.expandedIncomeCategory = this.expandedIncomeCategory === categoria ? null : categoria;
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
    return cuenta;
  }
}
