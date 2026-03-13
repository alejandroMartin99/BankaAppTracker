import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TransactionService } from '../../services/transaction.service';
import { Transaction } from '../../models/transaction.model';

const MONTHS = 12;
const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const EXCLUDE_THRESHOLD = 5000;

export interface MonthBar {
  monthKey: string;
  label: string;
  total: number;
  heightPct: number;
  aboveAverage: boolean;
}

export interface CategoryAnalysis {
  categoria: string;
  total: number;
  avgPerMonth: number;
  pctOfTotal: number;
  vsGlobalAvgPct: number; // % sobre la media global (positivo = por encima)
  monthsWithData: number;
}

@Component({
  selector: 'app-charts',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './charts.component.html',
  styleUrl: './charts.component.scss'
})
export class ChartsComponent implements OnInit, OnDestroy {
  transactions: Transaction[] = [];
  loading = false;
  showLoader = false;
  error: string | null = null;
  private destroy$ = new Subject<void>();

  /** Últimos 12 meses: gasto por mes */
  monthlyBars: MonthBar[] = [];
  /** Media mensual global (solo gastos, sin transferencias) */
  averageSpending = 0;
  /** Últimos 12 meses: ingresos por mes */
  incomeBars: MonthBar[] = [];
  /** Media mensual de ingresos (solo importes positivos, sin transferencias) */
  averageIncome = 0;
  /** Escala del gráfico de ingresos (para etiqueta eje Y) */
  incomeScaleRef = 0;
  /** Escala del eje Y: referencia para las barras (media * factor), no el máximo */
  chartScaleRef = 0;
  /** Total gastado en el período */
  totalPeriodSpending = 0;
  /** Meses con gasto por encima de la media */
  monthsAboveAvg = 0;
  /** Meses con gasto por debajo de la media */
  monthsBelowAvg = 0;
  /** Análisis por categoría: total, media mensual, % total, vs media global */
  categoryAnalysis: CategoryAnalysis[] = [];

  /** Excluir de las métricas gastos &gt; 5000 € (por defecto ACTIVADO) */
  excludeAbove5000 = true;
  /** Modal: al activar/desactivar el filtro, mostrar lista de movimientos afectados */
  excludeModalOpen = false;
  /** Valor que se aplicará al confirmar el modal (true = excluir, false = incluir) */
  excludeModalPending: boolean | null = null;

  constructor(private transactionService: TransactionService) {}

  ngOnInit(): void {
    this.loadData();
    this.transactionService.dataRefresh$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadData());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private getDateRange(): { from: string; to: string } {
    const to = new Date();
    const from = new Date(to.getFullYear(), to.getMonth() - (MONTHS - 1), 1);
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10)
    };
  }

  loadData(): void {
    this.loading = true;
    this.showLoader = true;
    this.error = null;
    const { from, to } = this.getDateRange();
    this.transactionService.getTransactions({
      from_date: from,
      to_date: to,
      limit: 5000,
      offset: 0
    }).subscribe({
      next: (res) => {
        const raw = res?.data;
        const arr = Array.isArray(raw) ? raw : (Array.isArray((raw as any)?.data) ? (raw as any).data : []);
        this.transactions = arr.map((t: any) => ({
          id: t.id,
          dt_date: t.dt_date || t.transaction_date || '',
          importe: typeof t.importe === 'number' ? t.importe : parseFloat(t.importe) || 0,
          categoria: (t.categoria || t.category || '').trim(),
          subcategoria: t.subcategoria || '',
          descripcion: t.descripcion || t.description || ''
        }));
        this.loading = false;
        this.showLoader = false;
        this.buildAnalysis();
      },
      error: (err) => {
        this.error = err.error?.detail || 'Error al cargar datos';
        this.loading = false;
        this.showLoader = false;
      }
    });
  }

  private expenseOnly(t: Transaction): boolean {
    return (t.importe || 0) < 0 && (t.categoria || '') !== 'Transferencia';
  }

  private incomeOnly(t: Transaction): boolean {
    return (t.importe || 0) > 0 && (t.categoria || '') !== 'Transferencia';
  }

  /** Movimientos con importe absoluto &gt; 5000 € (para el popup, gastos e ingresos) */
  get highExpenses(): Transaction[] {
    return this.transactions
      .filter(t => (this.expenseOnly(t) || this.incomeOnly(t)) && Math.abs(t.importe || 0) > EXCLUDE_THRESHOLD)
      .sort((a, b) => Math.abs(b.importe || 0) - Math.abs(a.importe || 0));
  }

  /** Si el movimiento debe excluirse de las métricas cuando el filtro &gt; 5000 € está activo */
  private shouldExclude(t: Transaction): boolean {
    if (!this.excludeAbove5000) return false;
    return Math.abs(t.importe || 0) > EXCLUDE_THRESHOLD;
  }

  openExcludeModal(activate: boolean): void {
    this.excludeModalPending = activate;
    this.excludeModalOpen = true;
  }

  closeExcludeModal(): void {
    this.excludeModalOpen = false;
    this.excludeModalPending = null;
  }

  confirmExcludeModal(): void {
    if (this.excludeModalPending !== null) {
      this.excludeAbove5000 = this.excludeModalPending;
      this.buildAnalysis();
    }
    this.closeExcludeModal();
  }

  private buildAnalysis(): void {
    const to = new Date();
    const byMonth = new Map<string, number>();
    const byMonthIncome = new Map<string, number>();
    for (let i = 0; i < MONTHS; i++) {
      const d = new Date(to.getFullYear(), to.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      byMonth.set(key, 0);
      byMonthIncome.set(key, 0);
    }

    for (const t of this.transactions) {
      const dt = (t.dt_date || '').slice(0, 7);
      if (!byMonth.has(dt)) continue;
      if (this.expenseOnly(t) && !this.shouldExclude(t)) {
        byMonth.set(dt, (byMonth.get(dt) || 0) + Math.abs(t.importe || 0));
      }
      if (this.incomeOnly(t) && !this.shouldExclude(t)) {
        byMonthIncome.set(dt, (byMonthIncome.get(dt) || 0) + (t.importe || 0));
      }
    }

    // Mantener mismos meses en ambos gráficos: recortar desde el primer mes con valores en gastos o ingresos
    let entries = Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b));
    let incomeEntries = Array.from(byMonthIncome.entries()).sort(([a], [b]) => a.localeCompare(b));
    let totals = entries.map(([, v]) => v);
    let incomeTotals = incomeEntries.map(([, v]) => v);
    const firstAnyValue = totals.findIndex((v, i) => v > 0 || incomeTotals[i] > 0);
    if (firstAnyValue >= 0) {
      entries = entries.slice(firstAnyValue);
      incomeEntries = incomeEntries.slice(firstAnyValue);
      totals = entries.map(([, v]) => v);
      incomeTotals = incomeEntries.map(([, v]) => v);
    }
    const totalSum = totals.reduce((s, v) => s + v, 0);
    this.averageSpending = totals.length > 0 ? totalSum / totals.length : 0;
    this.totalPeriodSpending = totalSum;

    const maxMonth = totals.length > 0 ? Math.max(...totals) : 0;
    this.chartScaleRef = Math.max(1, maxMonth);

    this.monthsAboveAvg = totals.filter(v => v > this.averageSpending).length;
    this.monthsBelowAvg = totals.filter(v => v < this.averageSpending).length;

    this.monthlyBars = entries.map(([monthKey, total]) => {
      const [y, m] = monthKey.split('-').map(Number);
      const label = `${MONTH_NAMES[m - 1]} ${String(y).slice(2)}`;
      const heightPct = this.chartScaleRef > 0
        ? Math.min(100, (total / this.chartScaleRef) * 100)
        : 0;
      return {
        monthKey,
        label,
        total,
        heightPct,
        aboveAverage: total > this.averageSpending
      };
    });

    // Ingresos por mes: mismos meses que gastos, escala = máximo
    const incomeSum = incomeTotals.reduce((s, v) => s + v, 0);
    this.averageIncome = incomeTotals.length > 0 ? incomeSum / incomeTotals.length : 0;
    const maxIncome = incomeTotals.length > 0 ? Math.max(...incomeTotals) : 0;
    this.incomeScaleRef = Math.max(1, maxIncome);
    this.incomeBars = incomeEntries.map(([monthKey, total]) => {
      const [y, m] = monthKey.split('-').map(Number);
      const label = `${MONTH_NAMES[m - 1]} ${String(y).slice(2)}`;
      const heightPct = this.incomeScaleRef > 0
        ? Math.min(100, (total / this.incomeScaleRef) * 100)
        : 0;
      return {
        monthKey,
        label,
        total,
        heightPct,
        aboveAverage: total > this.averageIncome
      };
    });

    // Análisis por categoría: total, media mensual, % del total, vs media global
    const byCatMonth = new Map<string, Map<string, number>>();
    for (const t of this.transactions) {
      if (this.shouldExclude(t)) continue;
      const cat = t.categoria || 'Sin categoría';
      const dt = (t.dt_date || '').slice(0, 7);
      if (!byMonth.has(dt)) continue;
      if (!byCatMonth.has(cat)) byCatMonth.set(cat, new Map());
      const monthTotals = byCatMonth.get(cat)!;
      monthTotals.set(dt, (monthTotals.get(dt) || 0) + Math.abs(t.importe || 0));
    }

    const catRows: CategoryAnalysis[] = [];
    for (const [categoria, monthTotals] of byCatMonth.entries()) {
      const amounts = Array.from(monthTotals.values());
      const total = amounts.reduce((a, b) => a + b, 0);
      const monthsWithData = amounts.length;
      const avgPerMonth = monthsWithData > 0 ? total / monthsWithData : 0;
      const pctOfTotal = totalSum > 0 ? (total / totalSum) * 100 : 0;
      const vsGlobalAvgPct = this.averageSpending > 0
        ? ((avgPerMonth - this.averageSpending) / this.averageSpending) * 100
        : 0;
      catRows.push({
        categoria,
        total,
        avgPerMonth,
        pctOfTotal,
        vsGlobalAvgPct,
        monthsWithData
      });
    }
    this.categoryAnalysis = catRows.sort((a, b) => b.total - a.total);
  }

  formatAmount(value: number): string {
    return new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value) + ' €';
  }

  formatAbsAmount(value: number | undefined): string {
    return this.formatAmount(Math.abs(value || 0));
  }

  formatSignedAmount(value: number | undefined): string {
    const v = value || 0;
    const abs = Math.abs(v);
    const base = this.formatAmount(abs);
    if (v > 0) return '+' + base;
    if (v < 0) return '-' + base;
    return base;
  }

  formatPercent(value: number): string {
    return new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value) + '%';
  }

  formatScaleRef(): string {
    return this.formatAmount(this.chartScaleRef);
  }

  formatIncomeScaleRef(): string {
    return this.formatAmount(this.incomeScaleRef);
  }

  hasAnyIncome(): boolean {
    return this.incomeBars.some(b => b.total > 0);
  }

  /** Ticks del eje Y para gastos (25%, 50%, 75% del máximo) */
  yTicks(): number[] {
    if (this.chartScaleRef <= 0) return [];
    const factors = [0.75, 0.5, 0.25];
    return factors.map(f => {
      const raw = this.chartScaleRef * f;
      const rounded = Math.ceil(raw / 10);
      return Math.max(10, rounded * 10);
    });
  }

  /** Ticks del eje Y para ingresos */
  incomeYTicks(): number[] {
    if (this.incomeScaleRef <= 0) return [];
    const factors = [0.75, 0.5, 0.25];
    return factors.map(f => {
      const raw = this.incomeScaleRef * f;
      const rounded = Math.ceil(raw / 10);
      return Math.max(10, rounded * 10);
    });
  }

  formatDate(d: string | undefined): string {
    if (!d) return '—';
    const s = String(d).slice(0, 10);
    if (s.length < 10) return s;
    return new Date(s + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}
