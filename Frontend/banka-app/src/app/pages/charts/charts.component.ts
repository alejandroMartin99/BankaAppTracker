import { Component, OnInit, OnDestroy } from '@angular/core';
import { trigger, transition, style, animate } from '@angular/animations';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
  /** Importe en el último mes completo mostrado en los gráficos */
  lastMonthValue: number;
  /** Variación del último mes frente a la media mensual de la categoría (%) */
  lastMonthVsAvgPct: number;
  monthsWithData: number;
}

/** Datos para la vista "ver más": eje X = categorías, eje Y = dinero, una línea por mes */
export interface CategoryChartData {
  categoryLabels: string[];
  monthSeries: { label: string; monthKey: string; values: number[] }[];
  maxAmount: number;
}

@Component({
  selector: 'app-charts',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './charts.component.html',
  styleUrl: './charts.component.scss',
  animations: [
    trigger('loaderOverlay', [
      transition(':enter', [style({ opacity: 0 }), animate('200ms ease-out', style({ opacity: 1 }))]),
      transition(':leave', [animate('180ms ease-in', style({ opacity: 0 }))])
    ])
  ]
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
  /** Análisis por categoría (gastos): total, media mensual, % total ≤100, último mes vs media */
  categoryAnalysisExpenses: CategoryAnalysis[] = [];
  /** Análisis por categoría (ingresos): total, media mensual, % total ≤100, último mes vs media */
  categoryAnalysisIncome: CategoryAnalysis[] = [];

  /** Serie mensual por categoría para popup: gastos */
  private categoryMonthlySeriesExpenses: Record<string, Map<string, number>> = {};
  private categoryAvgPerMonthExpenses: Record<string, number> = {};
  /** Serie mensual por categoría para popup: ingresos */
  private categoryMonthlySeriesIncome: Record<string, Map<string, number>> = {};
  private categoryAvgPerMonthIncome: Record<string, number> = {};

  /** Vista expandida del gráfico (ojo): por categorías, una línea por mes */
  chartExpensesExpanded = false;
  chartIncomeExpanded = false;

  /** Excluir de las métricas gastos &gt; 5000 € (por defecto ACTIVADO) */
  excludeAbove5000 = true;

  /** Excluir en la tabla de gastos categorías con &lt; 1 % del total (por defecto activado) */
  excludeUnder1PctExpenses = true;
  /** Excluir en la tabla de ingresos categorías con &lt; 1 % del total (por defecto activado) */
  excludeUnder1PctIncome = true;
  /** Modal: al activar/desactivar el filtro, mostrar lista de movimientos afectados */
  excludeModalOpen = false;
  /** Valor que se aplicará al confirmar el modal (true = excluir, false = incluir) */
  excludeModalPending: boolean | null = null;

  /** Popup detalle por categoría (evolución mensual) */
  categoryDetailOpen = false;
  categoryDetailName = '';
  /** true = gastos (positivo=rojo, negativo=verde), false = ingresos (positivo=verde, negativo=rojo) */
  categoryDetailIsExpense = true;
  categoryDetailSeries: { monthLabel: string; total: number; vsAvgPct: number; heightPct: number }[] = [];
  /** Escala y media para la gráfica del popup */
  categoryDetailScaleRef = 0;
  categoryDetailAvg = 0;

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

    // Gastos por categoría: total, media, % del total gastos (máx 100%)
    const byCatMonthExp = new Map<string, Map<string, number>>();
    for (const t of this.transactions) {
      if (!this.expenseOnly(t) || this.shouldExclude(t)) continue;
      const cat = t.categoria || 'Sin categoría';
      const dt = (t.dt_date || '').slice(0, 7);
      if (!byMonth.has(dt)) continue;
      if (!byCatMonthExp.has(cat)) byCatMonthExp.set(cat, new Map());
      const monthTotals = byCatMonthExp.get(cat)!;
      monthTotals.set(dt, (monthTotals.get(dt) || 0) + Math.abs(t.importe || 0));
    }
    const expenseCatRows: CategoryAnalysis[] = [];
    for (const [categoria, monthTotals] of byCatMonthExp.entries()) {
      const amounts = Array.from(monthTotals.values());
      const total = amounts.reduce((a, b) => a + b, 0);
      const monthsWithData = amounts.length;
      const avgPerMonth = monthsWithData > 0 ? total / monthsWithData : 0;
      const pctOfTotal = totalSum > 0 ? Math.min(100, (total / totalSum) * 100) : 0;
      this.categoryMonthlySeriesExpenses[categoria] = monthTotals;
      this.categoryAvgPerMonthExpenses[categoria] = avgPerMonth;
      const lastMonthKey = entries.length ? entries[entries.length - 1][0] : '';
      const lastMonthValue = lastMonthKey ? (monthTotals.get(lastMonthKey) || 0) : 0;
      let lastMonthVsAvgPct = 0;
      if (avgPerMonth > 0) {
        lastMonthVsAvgPct = ((lastMonthValue - avgPerMonth) / avgPerMonth) * 100;
      }
      expenseCatRows.push({
        categoria,
        total,
        avgPerMonth,
        pctOfTotal,
        lastMonthValue,
        lastMonthVsAvgPct,
        monthsWithData
      });
    }
    this.categoryAnalysisExpenses = expenseCatRows.sort((a, b) => b.total - a.total);

    // Ingresos por categoría: total, media, % del total ingresos (máx 100%)
    const byCatMonthInc = new Map<string, Map<string, number>>();
    for (const t of this.transactions) {
      if (!this.incomeOnly(t) || this.shouldExclude(t)) continue;
      const cat = t.categoria || 'Sin categoría';
      const dt = (t.dt_date || '').slice(0, 7);
      if (!byMonthIncome.has(dt)) continue;
      if (!byCatMonthInc.has(cat)) byCatMonthInc.set(cat, new Map());
      const monthTotals = byCatMonthInc.get(cat)!;
      monthTotals.set(dt, (monthTotals.get(dt) || 0) + (t.importe || 0));
    }
    const incomeCatRows: CategoryAnalysis[] = [];
    for (const [categoria, monthTotals] of byCatMonthInc.entries()) {
      const amounts = Array.from(monthTotals.values());
      const total = amounts.reduce((a, b) => a + b, 0);
      const monthsWithData = amounts.length;
      const avgPerMonth = monthsWithData > 0 ? total / monthsWithData : 0;
      const pctOfTotal = incomeSum > 0 ? Math.min(100, (total / incomeSum) * 100) : 0;
      this.categoryMonthlySeriesIncome[categoria] = monthTotals;
      this.categoryAvgPerMonthIncome[categoria] = avgPerMonth;
      const lastMonthKey = incomeEntries.length ? incomeEntries[incomeEntries.length - 1][0] : '';
      const lastMonthValue = lastMonthKey ? (monthTotals.get(lastMonthKey) || 0) : 0;
      let lastMonthVsAvgPct = 0;
      if (avgPerMonth > 0) {
        lastMonthVsAvgPct = ((lastMonthValue - avgPerMonth) / avgPerMonth) * 100;
      }
      incomeCatRows.push({
        categoria,
        total,
        avgPerMonth,
        pctOfTotal,
        lastMonthValue,
        lastMonthVsAvgPct,
        monthsWithData
      });
    }
    this.categoryAnalysisIncome = incomeCatRows.sort((a, b) => b.total - a.total);
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

  /** Filas de la tabla de gastos (filtradas por &lt; 1 % si excludeUnder1PctExpenses) */
  getExpensesTableRows(): CategoryAnalysis[] {
    if (!this.excludeUnder1PctExpenses) return this.categoryAnalysisExpenses;
    return this.categoryAnalysisExpenses.filter(r => r.pctOfTotal >= 1);
  }

  /** Filas de la tabla de ingresos (filtradas por &lt; 1 % si excludeUnder1PctIncome) */
  getIncomeTableRows(): CategoryAnalysis[] {
    if (!this.excludeUnder1PctIncome) return this.categoryAnalysisIncome;
    return this.categoryAnalysisIncome.filter(r => r.pctOfTotal >= 1);
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

  /** Datos para vista por categorías (gastos): eje X = categorías, Y = dinero, una línea por mes */
  getCategoryChartDataExpenses(): CategoryChartData {
    const categoryLabels = this.categoryAnalysisExpenses.map(r => r.categoria);
    if (categoryLabels.length === 0) {
      return { categoryLabels: [], monthSeries: [], maxAmount: 0 };
    }
    const monthSeries = this.monthlyBars.map(bar => ({
      label: bar.label,
      monthKey: bar.monthKey,
      values: categoryLabels.map(cat =>
        this.categoryMonthlySeriesExpenses[cat]?.get(bar.monthKey) ?? 0
      )
    }));
    let maxAmount = 0;
    for (const s of monthSeries) {
      for (const v of s.values) {
        if (v > maxAmount) maxAmount = v;
      }
    }
    return { categoryLabels, monthSeries, maxAmount: Math.max(1, maxAmount) };
  }

  /** Datos para vista por categorías (ingresos): eje X = categorías, Y = dinero, una línea por mes */
  getCategoryChartDataIncome(): CategoryChartData {
    const categoryLabels = this.categoryAnalysisIncome.map(r => r.categoria);
    if (categoryLabels.length === 0) {
      return { categoryLabels: [], monthSeries: [], maxAmount: 0 };
    }
    const monthSeries = this.incomeBars.map(bar => ({
      label: bar.label,
      monthKey: bar.monthKey,
      values: categoryLabels.map(cat =>
        this.categoryMonthlySeriesIncome[cat]?.get(bar.monthKey) ?? 0
      )
    }));
    let maxAmount = 0;
    for (const s of monthSeries) {
      for (const v of s.values) {
        if (v > maxAmount) maxAmount = v;
      }
    }
    return { categoryLabels, monthSeries, maxAmount: Math.max(1, maxAmount) };
  }

  /** Genera el path SVG para una línea (valores por categoría): eje X = dinero, eje Y = categoría */
  getCategoryLinePath(values: number[], maxAmount: number): string {
    const n = values.length;
    if (n === 0 || maxAmount <= 0) return '';
    const padL = 56;
    const padR = 24;
    const padT = 12;
    const padB = 36;
    const chartH = 180 - padT - padB;
    const chartW = 400 - padL - padR;
    const points = values.map((v, i) => {
      const x = padL + (v / maxAmount) * chartW;
      const y = padT + (n <= 1 ? 0 : (i / (n - 1)) * chartH);
      return `${x},${y}`;
    });
    return 'M' + points.join(' L');
  }

  /** Coordenada X en SVG para etiqueta de categoría (eje Y): índice 0..n-1 */
  categoryChartYPos(i: number, n: number): number {
    if (n <= 1) return 12 + 90;
    return 12 + (i / (n - 1)) * (180 - 12 - 36);
  }

  formatDate(d: string | undefined): string {
    if (!d) return '—';
    const s = String(d).slice(0, 10);
    if (s.length < 10) return s;
    return new Date(s + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  openCategoryDetail(categoria: string, isExpense: boolean): void {
    const series = isExpense
      ? this.categoryMonthlySeriesExpenses[categoria]
      : this.categoryMonthlySeriesIncome[categoria];
    const avg = isExpense
      ? (this.categoryAvgPerMonthExpenses[categoria] || 0)
      : (this.categoryAvgPerMonthIncome[categoria] || 0);
    if (!series) {
      this.categoryDetailOpen = false;
      return;
    }
    this.categoryDetailIsExpense = isExpense;
    const entries = Array.from(series.entries()).sort((e1, e2) => e1[0].localeCompare(e2[0]));
    const totals = entries.map(([, t]) => t);
    const maxTotal = totals.length > 0 ? Math.max(...totals) : 0;
    this.categoryDetailScaleRef = Math.max(1, maxTotal);
    this.categoryDetailAvg = avg;
    this.categoryDetailName = categoria;
    this.categoryDetailSeries = entries.map(([monthKey, total]) => {
      const [y, m] = monthKey.split('-').map(Number);
      const monthLabel = `${MONTH_NAMES[m - 1]} ${String(y).slice(2)}`;
      let vs = 0;
      if (avg > 0) {
        vs = ((total - avg) / avg) * 100;
      }
      const heightPct = this.categoryDetailScaleRef > 0
        ? Math.min(100, (total / this.categoryDetailScaleRef) * 100)
        : 0;
      return { monthLabel, total, vsAvgPct: vs, heightPct };
    });
    this.categoryDetailOpen = true;
  }

  closeCategoryDetail(): void {
    this.categoryDetailOpen = false;
  }
}
