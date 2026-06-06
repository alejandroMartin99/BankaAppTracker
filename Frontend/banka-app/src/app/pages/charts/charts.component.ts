import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TransactionService } from '../../services/transaction.service';
import { Transaction } from '../../models/transaction.model';
import { PrivacyService } from '../../services/privacy.service';

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

/** Prueba en popup subcategorías: eje X = meses, una línea por subcategoría */
export interface SubcategoryLineChartModel {
  monthLabels: string[];
  series: { subcategoria: string; values: number[]; color: string; avgPerMonth: number }[];
  maxAmount: number;
}

/** Filas de la tabla bajo el gráfico de subcategorías (mismo top N que el gráfico). */
export interface SubcategoryDetailTableRow {
  subcategoria: string;
  avgPerMonth: number;
  lastMonthValue: number;
  /** Último mes − media propia de la subcategoría (€). */
  deltaVsOwnAvgEur: number;
  /** Cuánto representa esta subcategoría en el total de la categoría en el último mes (0–100). */
  pctOfCategoryLastMonth: number;
  lastMonthVsAvgPct: number;
  /** Meses del período con importe &gt; 0 (para detectar “nuevo” / un solo mes). */
  monthsWithData: number;
}

@Component({
  selector: 'app-charts',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  templateUrl: './charts.component.html',
  styleUrl: './charts.component.scss',
})
export class ChartsComponent implements OnInit, OnDestroy {
  transactions: Transaction[] = [];
  loading = false;
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

  /** Popup "ver más": barras por categoría con filtro de mes */
  categoryChartModalOpen = false;
  categoryChartModalIsExpense = true;
  /** Mes seleccionado en el popup (monthKey). Lo marca el clic en barra mensual. */
  selectedCategoryChartMonthKey = '';

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
  categoryDetailSeries: {
    monthKey: string;
    monthLabel: string;
    total: number;
    vsAvgPct: number;
    heightPct: number;
  }[] = [];
  /** Escala y media para la gráfica del popup */
  categoryDetailScaleRef = 0;
  categoryDetailAvg = 0;
  /** Vista del modal detalle por categoría */
  categoryDetailViewMode: 'categoria' | 'subcategoria' = 'categoria';
  /** Diagrama de líneas mes × subcategoría (mismo período que la evolución de la categoría) */
  categoryDetailSubLineChart: SubcategoryLineChartModel | null = null;
  selectedBalanceChartAccount = '';
  private balanceHistorySeriesCache: { dateKey: string; label: string; saldo: number }[] = [];
  /** Por día: primer y último apunte (saldo tras movimiento) para la tabla mensual */
  private balanceDaySnapshotsCache = new Map<
    string,
    { first: { dt: string; saldo: number; importe: number }; last: { dt: string; saldo: number; importe: number } }
  >();
  private balanceHistoryMinCache = 0;
  private balanceHistoryMaxCache = 1;

  private static readonly SUB_LINE_VB = { vw: 340, vh: 172, padL: 52, padR: 10, padT: 10, padB: 40 } as const;
  /** Expuesto para el SVG del drill de subcategorías */
  readonly subLinePadLeft = ChartsComponent.SUB_LINE_VB.padL;
  private static readonly BALANCE_VB = { w: 360, h: 180, padL: 48, padR: 14, padT: 12, padB: 30 } as const;

  constructor(
    private transactionService: TransactionService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    public privacy: PrivacyService
  ) {}

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
    this.error = null;
    const { from, to } = this.getDateRange();
    this.transactionService.getTransactions({
      from_date: from,
      to_date: to
    }).subscribe({
      next: (res) => {
        this.ngZone.run(() => {
          const raw = res?.data;
          const arr = Array.isArray(raw) ? raw : (Array.isArray((raw as any)?.data) ? (raw as any).data : []);
          this.transactions = arr.map((t: any) => ({
            id: t.id,
            dt_date: t.dt_date || t.transaction_date || '',
            importe: typeof t.importe === 'number' ? t.importe : parseFloat(t.importe) || 0,
            saldo: t.saldo != null ? (typeof t.saldo === 'number' ? t.saldo : parseFloat(t.saldo)) : undefined,
            cuenta: t.cuenta || t.account_number || '',
            categoria: (t.categoria || t.category || '').trim(),
            subcategoria: t.subcategoria || '',
            descripcion: t.descripcion || t.description || ''
          }));
          this.loading = false;
          this.buildAnalysis();
          this.ensureBalanceChartAccount();
          this.recomputeBalanceChartData();
          this.cdr.detectChanges();
        });
      },
      error: (err) => {
        this.ngZone.run(() => {
          this.error = err.error?.detail || 'Error al cargar datos';
          this.loading = false;
          this.cdr.detectChanges();
        });
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
      this.recomputeBalanceChartData();
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

  get balanceChartAccounts(): string[] {
    const set = new Set<string>();
    for (const t of this.transactions) {
      const account = (t.cuenta || '').toString().trim();
      if (account) set.add(account);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }

  private ensureBalanceChartAccount(): void {
    const accounts = this.balanceChartAccounts;
    if (!accounts.length) {
      this.selectedBalanceChartAccount = '';
      return;
    }
    if (!accounts.includes(this.selectedBalanceChartAccount)) {
      this.selectedBalanceChartAccount = accounts[0];
    }
  }

  selectBalanceChartAccount(account: string): void {
    this.selectedBalanceChartAccount = account;
    this.recomputeBalanceChartData();
  }

  get balanceHistorySeries(): { dateKey: string; label: string; saldo: number }[] {
    return this.balanceHistorySeriesCache;
  }

  get balanceHistoryMin(): number {
    return this.balanceHistoryMinCache;
  }

  get balanceHistoryMax(): number {
    return this.balanceHistoryMaxCache;
  }

  get balanceAxisMin(): number {
    const { min } = this.balanceAxisBounds;
    return min;
  }

  get balanceAxisMax(): number {
    const { max } = this.balanceAxisBounds;
    return max;
  }

  private get balanceTickStep(): number {
    const min = this.balanceHistoryMin;
    const max = this.balanceHistoryMax;
    const span = Math.max(1, max - min);
    const targetTicks = 5;
    const rough = span / targetTicks;
    return Math.max(100, Math.ceil(rough / 100) * 100);
  }

  private get balanceAxisBounds(): { min: number; max: number } {
    const step = this.balanceTickStep;
    const min = Math.floor(this.balanceHistoryMin / step) * step;
    let max = Math.ceil(this.balanceHistoryMax / step) * step;
    if (max <= min) max = min + step;
    return { min, max };
  }

  get balanceHistoryValues(): number[] {
    return this.balanceHistorySeriesCache.map(x => x.saldo);
  }

  get balanceHistoryPath(): string {
    const points = this.balanceHistoryPoints;
    if (!points.length) return '';
    return 'M ' + points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L ');
  }

  get balanceHistoryPoints(): { x: number; y: number; label: string; saldo: number; key: string }[] {
    const series = this.balanceHistorySeries;
    const n = series.length;
    if (!n) return [];
    const min = this.balanceAxisMin;
    const max = this.balanceAxisMax;
    const { w, padL, padR } = ChartsComponent.BALANCE_VB;
    const plotW = w - padL - padR;
    return series.map((row, i) => {
      const x = n <= 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW;
      return {
        x,
        y: this.balanceY(row.saldo, min, max),
        label: row.label,
        saldo: row.saldo,
        key: row.dateKey
      };
    });
  }

  get balanceChartViewBox(): string {
    const { w, h } = ChartsComponent.BALANCE_VB;
    return `0 0 ${w} ${h}`;
  }

  private balanceY(value: number, min: number, max: number): number {
    const { h, padT, padB } = ChartsComponent.BALANCE_VB;
    const plotH = h - padT - padB;
    const span = Math.max(1, max - min);
    return padT + plotH - ((value - min) / span) * plotH;
  }

  balanceChartLeft(): number {
    return ChartsComponent.BALANCE_VB.padL;
  }

  balanceChartRight(): number {
    const { w, padR } = ChartsComponent.BALANCE_VB;
    return w - padR;
  }

  get balanceHistoryYTicks(): { y: number; value: number; base: boolean }[] {
    const min = this.balanceAxisMin;
    const max = this.balanceAxisMax;
    const step = this.balanceTickStep;
    const out: { y: number; value: number; base: boolean }[] = [];
    for (let value = max; value >= min; value -= step) {
      out.push({ y: this.balanceY(value, min, max), value, base: value === min });
    }
    return out;
  }

  get balanceHistoryXTicks(): { x: number; label: string; key: string }[] {
    const points = this.balanceHistoryPoints;
    if (!points.length) return [];
    const maxTicks = 8;
    if (points.length <= maxTicks) {
      return points.map((p) => ({ x: p.x, label: this.formatBalanceChartDay(p.key), key: p.key }));
    }
    const out: { x: number; label: string; key: string }[] = [];
    const used = new Set<string>();
    const step = Math.max(1, Math.round((points.length - 1) / (maxTicks - 1)));
    for (let i = 0; i < points.length; i += step) {
      const p = points[i]!;
      if (used.has(p.key)) continue;
      used.add(p.key);
      out.push({ x: p.x, label: this.formatBalanceChartDay(p.key), key: p.key });
    }
    const last = points[points.length - 1]!;
    if (!used.has(last.key)) {
      out.push({ x: last.x, label: this.formatBalanceChartDay(last.key), key: last.key });
    }
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }

  get monthStartBalanceRows(): {
    monthKey: string;
    monthLabel: string;
    saldoDia1: number;
    saldoDia30: number;
    fechaInicio: string;
    fechaFin: string;
    ahorroMes: number;
  }[] {
    const byMonth = new Map<string, string[]>();
    for (const dateKey of this.balanceDaySnapshotsCache.keys()) {
      const monthKey = dateKey.slice(0, 7);
      if (!monthKey) continue;
      if (!byMonth.has(monthKey)) byMonth.set(monthKey, []);
      byMonth.get(monthKey)!.push(dateKey);
    }

    const months = Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monthKey, dateKeys]) => {
        const ordered = [...dateKeys].sort((a, b) => a.localeCompare(b));
        const firstDay = this.balanceDaySnapshotsCache.get(ordered[0]!)!;
        const lastDay = this.balanceDaySnapshotsCache.get(ordered[ordered.length - 1]!)!;
        return {
          monthKey,
          monthLabel: this.formatMonthKey(monthKey),
          saldoFinMes: lastDay.last.saldo,
          fechaInicioMes: ordered[0]!,
          fechaFinMes: ordered[ordered.length - 1]!,
          /** Saldo antes del primer movimiento del periodo (no cuenta ese importe dos veces) */
          saldoAperturaPeriodo: firstDay.first.saldo - firstDay.first.importe
        };
      });

    return months.map((row, idx) => {
      const saldoInicio = idx === 0 ? row.saldoAperturaPeriodo : months[idx - 1]!.saldoFinMes;
      const fechaInicio = idx === 0 ? row.fechaInicioMes : months[idx - 1]!.fechaFinMes;
      return {
        monthKey: row.monthKey,
        monthLabel: row.monthLabel,
        saldoDia1: saldoInicio,
        saldoDia30: row.saldoFinMes,
        fechaInicio,
        fechaFin: row.fechaFinMes,
        ahorroMes: row.saldoFinMes - saldoInicio
      };
    });
  }

  private formatMonthKey(monthKey: string): string {
    const [y, m] = monthKey.split('-').map(Number);
    if (!y || !m) return monthKey;
    return new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long' });
  }

  private recomputeBalanceChartData(): void {
    if (!this.selectedBalanceChartAccount) {
      this.balanceHistorySeriesCache = [];
      this.balanceDaySnapshotsCache = new Map();
      this.balanceHistoryMinCache = 0;
      this.balanceHistoryMaxCache = 1;
      return;
    }
    const currentYear = new Date().getFullYear();
    const byDay = new Map<
      string,
      { first: { dt: string; saldo: number; importe: number }; last: { dt: string; saldo: number; importe: number } }
    >();
    for (const t of this.transactions) {
      if ((t.cuenta || '') !== this.selectedBalanceChartAccount) continue;
      if (this.shouldExclude(t)) continue;
      if (t.saldo == null || Number.isNaN(t.saldo)) continue;
      const dt = (t.dt_date || '').trim();
      const dateKey = dt.slice(0, 10);
      if (!dateKey) continue;
      if (Number(dateKey.slice(0, 4)) !== currentYear) continue;
      const importe = typeof t.importe === 'number' ? t.importe : parseFloat(String(t.importe)) || 0;
      const snap = { dt, saldo: t.saldo, importe };
      const prev = byDay.get(dateKey);
      if (!prev) {
        byDay.set(dateKey, { first: snap, last: snap });
        continue;
      }
      if (dt.localeCompare(prev.first.dt) < 0) prev.first = snap;
      if (dt.localeCompare(prev.last.dt) >= 0) prev.last = snap;
    }
    this.balanceDaySnapshotsCache = byDay;
    this.balanceHistorySeriesCache = Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dateKey, row]) => ({
        dateKey,
        label: this.formatBalanceChartDay(dateKey),
        saldo: row.last.saldo
      }));
    const vals = this.balanceHistorySeriesCache.map(x => x.saldo);
    this.balanceHistoryMinCache = vals.length ? Math.min(...vals) : 0;
    this.balanceHistoryMaxCache = vals.length ? Math.max(...vals) : 1;
  }

  formatBalanceYAxis(value: number): string {
    if (this.privacy.hideBalances()) return '***';
    const abs = Math.abs(value);
    if (abs >= 1000) {
      const k = abs / 1000;
      const text = k >= 10 ? k.toFixed(0) : k.toFixed(1);
      return `${value < 0 ? '-' : ''}${text}k €`;
    }
    return `${Math.round(value)} €`;
  }

  formatShortDayMonth(dateKey: string): string {
    if (!dateKey) return '--';
    const d = dateKey.slice(8, 10);
    const m = dateKey.slice(5, 7);
    return `${d}-${m}`;
  }

  get balanceTrendPath(): string {
    const series = this.balanceHistorySeries;
    const n = series.length;
    if (n < 2) return '';
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      xs.push(i);
      ys.push(series[i]!.saldo);
    }
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i]! - meanX;
      num += dx * (ys[i]! - meanY);
      den += dx * dx;
    }
    const slope = den > 0 ? num / den : 0;
    const intercept = meanY - slope * meanX;
    const y0 = intercept;
    const y1 = intercept + slope * (n - 1);
    const min = this.balanceAxisMin;
    const max = this.balanceAxisMax;
    const leftX = this.balanceChartLeft();
    const rightX = this.balanceChartRight();
    const leftY = this.balanceY(y0, min, max);
    const rightY = this.balanceY(y1, min, max);
    return `M ${leftX.toFixed(2)},${leftY.toFixed(2)} L ${rightX.toFixed(2)},${rightY.toFixed(2)}`;
  }

  monthlySavingsLabel(value: number | null): string {
    if (value == null) return '—';
    if (this.privacy.hideBalances()) return '***';
    if (value > 0) return `Ahorras ${this.formatAmount(value)}`;
    if (value < 0) return `Pierdes ${this.formatAmount(Math.abs(value))}`;
    return 'Sin cambio';
  }

  formatBalanceChartDay(dateKey: string): string {
    if (!dateKey) return '';
    const d = new Date(dateKey + 'T12:00:00');
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
  }

  formatAmount(value: number): string {
    if (this.privacy.hideBalances()) return '***';
    return new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value) + ' €';
  }

  formatAbsAmount(value: number | undefined): string {
    return this.formatAmount(Math.abs(value || 0));
  }

  formatSignedAmount(value: number | undefined): string {
    if (this.privacy.hideBalances()) return '***';
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

  /**
   * Últ. mes vs media: con un solo mes con datos la media = último mes → 0% no aporta.
   * En ese caso mostramos 100% como “todo el histórico reciente está en el último mes”.
   */
  lastMonthVsAvgPresentation(row: {
    lastMonthVsAvgPct: number;
    lastMonthValue: number;
    monthsWithData: number;
  }): { text: string; neutral: boolean; hint?: string } {
    const pct = row.lastMonthVsAvgPct;
    const last = row.lastMonthValue;
    const mh = row.monthsWithData;
    if (last <= 0) return { text: '—', neutral: true };
    if (mh <= 1 && Math.abs(pct) < 0.05) {
      return {
        text: '100%',
        neutral: true,
        hint: 'Solo hay movimientos en un mes del período; la media mensual coincide con el último mes.',
      };
    }
    const prefix = pct > 0 ? '+' : '';
    return { text: prefix + this.formatPercent(pct), neutral: false };
  }

  lastMonthVsAvgToneOver(isExpense: boolean, pct: number, neutral: boolean): boolean {
    if (neutral) return false;
    return (isExpense && pct > 0) || (!isExpense && pct < 0);
  }

  lastMonthVsAvgToneUnder(isExpense: boolean, pct: number, neutral: boolean): boolean {
    if (neutral) return false;
    return (isExpense && pct < 0) || (!isExpense && pct > 0);
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

  /** Path SVG: evolución mensual (eje X = tiempo, Y = importe) para una subcategoría */
  getSubcategoryTrendPath(values: number[], maxAmount: number): string {
    const pts = this.getSubcategoryTrendPoints(values, maxAmount);
    if (pts.length === 0) return '';
    return 'M ' + pts.map(p => `${p.x},${p.y}`).join(' L ');
  }

  getSubcategoryTrendPoints(values: number[], maxAmount: number): { x: number; y: number }[] {
    const { vw, vh, padL, padR, padT, padB } = ChartsComponent.SUB_LINE_VB;
    const chartW = vw - padL - padR;
    const chartH = vh - padT - padB;
    const n = values.length;
    if (n === 0 || maxAmount <= 0) return [];
    return values.map((v, i) => {
      const x = n <= 1 ? padL + chartW / 2 : padL + (i / (n - 1)) * chartW;
      const clamped = Math.min(v, maxAmount);
      const y = padT + chartH - (clamped / maxAmount) * chartH;
      return { x, y };
    });
  }

  /** Posición Y en el SVG del gráfico de líneas para un importe (media, punto, etc.). */
  subLineYForValue(value: number, maxAmount: number): number {
    const { vh, padT, padB } = ChartsComponent.SUB_LINE_VB;
    const chartH = vh - padT - padB;
    if (maxAmount <= 0) return padT + chartH;
    const clamped = Math.min(Math.max(0, value), maxAmount);
    return padT + chartH - (clamped / maxAmount) * chartH;
  }

  /** Líneas horizontales de rejilla + valores eje Y (0 … máx). `base` = eje X inferior. */
  getSubLineYGridTicks(): { y: number; value: number; base: boolean }[] {
    const c = this.categoryDetailSubLineChart;
    if (!c) return [];
    const max = c.maxAmount;
    const { vh, padT, padB } = ChartsComponent.SUB_LINE_VB;
    const chartH = vh - padT - padB;
    const segments = 4;
    const out: { y: number; value: number; base: boolean }[] = [];
    for (let i = 0; i <= segments; i++) {
      const frac = 1 - i / segments;
      out.push({
        y: padT + chartH * (1 - frac),
        value: max * frac,
        base: i === segments
      });
    }
    return out;
  }

  subLineChartRight(): number {
    const { vw, padR } = ChartsComponent.SUB_LINE_VB;
    return vw - padR;
  }

  subLineChartBottomY(): number {
    const { vh, padB } = ChartsComponent.SUB_LINE_VB;
    return vh - padB;
  }

  /** Etiquetas eje Y compactas */
  formatSubLineYAxis(value: number): string {
    if (this.privacy.hideBalances()) return '***';
    const v = Math.max(0, value);
    if (v >= 1000) {
      const k = v / 1000;
      return (k >= 10 ? k.toFixed(0) : k.toFixed(1)) + 'k €';
    }
    if (v < 1 && v > 0) return v.toFixed(0) + ' €';
    return Math.round(v) + ' €';
  }

  /** Posición X centrada para etiqueta de mes bajo el gráfico de líneas */
  subLineMonthLabelX(i: number): number {
    const c = this.categoryDetailSubLineChart;
    if (!c) return 0;
    const { vw, padL, padR } = ChartsComponent.SUB_LINE_VB;
    const chartW = vw - padL - padR;
    const n = c.monthLabels.length;
    if (n <= 1) return padL + chartW / 2;
    return padL + (i / (n - 1)) * chartW;
  }

  subLineSvgViewBox(): string {
    const { vw, vh } = ChartsComponent.SUB_LINE_VB;
    return `0 0 ${vw} ${vh}`;
  }

  /** Etiqueta del mes más reciente del modal (misma columna derecha del gráfico). */
  categoryDetailFocusedMonthLabel(): string {
    const ser = this.categoryDetailSeries;
    if (!ser.length) return 'Mes reciente';
    return ser[ser.length - 1]!.monthLabel || 'Mes reciente';
  }

  /**
   * Tabla bajo el gráfico de líneas: orientada al **último mes** y al **desvío en €**
   * frente a la media propia de cada subcategoría (encaja con el % vs media de la categoría).
   */
  getSubcategoryDetailTableRows(): SubcategoryDetailTableRow[] {
    const chart = this.categoryDetailSubLineChart;
    if (!chart || chart.series.length === 0) return [];
    const ser = this.categoryDetailSeries;
    const categoryLastMonthTotal =
      ser.length > 0 ? Math.max(0, ser[ser.length - 1]!.total) : 0;
    const rows: SubcategoryDetailTableRow[] = [];
    for (const s of chart.series) {
      const lastMonthValue = s.values.length ? s.values[s.values.length - 1]! : 0;
      const monthsWithData = s.values.filter((v) => v > 0).length;
      const avgPerMonth = s.avgPerMonth;
      const deltaVsOwnAvgEur = lastMonthValue - avgPerMonth;
      let lastMonthVsAvgPct = 0;
      if (avgPerMonth > 0) {
        lastMonthVsAvgPct = ((lastMonthValue - avgPerMonth) / avgPerMonth) * 100;
      }
      const pctOfCategoryLastMonth =
        categoryLastMonthTotal > 0
          ? Math.min(100, (lastMonthValue / categoryLastMonthTotal) * 100)
          : 0;
      rows.push({
        subcategoria: s.subcategoria,
        avgPerMonth,
        lastMonthValue,
        deltaVsOwnAvgEur,
        pctOfCategoryLastMonth,
        lastMonthVsAvgPct,
        monthsWithData,
      });
    }
    rows.sort((a, b) => Math.abs(b.deltaVsOwnAvgEur) - Math.abs(a.deltaVsOwnAvgEur));
    return rows;
  }

  /** Puntos para marcadores (evita @for anidado con track inválido). */
  getSubLineAllDots(): { cx: number; cy: number; stroke: string; key: string }[] {
    const c = this.categoryDetailSubLineChart;
    if (!c) return [];
    const max = c.maxAmount;
    const out: { cx: number; cy: number; stroke: string; key: string }[] = [];
    for (const s of c.series) {
      const pts = this.getSubcategoryTrendPoints(s.values, max);
      pts.forEach((p, i) => {
        out.push({
          cx: p.x,
          cy: p.y,
          stroke: s.color,
          key: `${s.subcategoria}:${i}`
        });
      });
    }
    return out;
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
      return { monthKey, monthLabel, total, vsAvgPct: vs, heightPct };
    });
    this.categoryDetailViewMode = 'categoria';
    this.categoryDetailSubLineChart = null;
    this.buildCategoryDetailSubLineChartAllMonths();
    this.categoryDetailOpen = true;
  }

  setCategoryDetailViewMode(mode: 'categoria' | 'subcategoria'): void {
    this.categoryDetailViewMode = mode;
    if (mode === 'subcategoria' && !this.categoryDetailSubLineChart) {
      this.buildCategoryDetailSubLineChartAllMonths();
    }
  }

  private buildCategoryDetailSubLineChartAllMonths(): void {
    const cat = this.categoryDetailName;
    const isExp = this.categoryDetailIsExpense;
    const monthKeysOrder = this.categoryDetailSeries.map(s => s.monthKey);
    if (monthKeysOrder.length === 0) {
      this.categoryDetailSubLineChart = null;
      return;
    }

    /** Serie mensual por subcategoría (mismo período que la categoría en el popup) */
    const subMonthlyMaps = new Map<string, Map<string, number>>();
    for (const t of this.transactions) {
      if (this.shouldExclude(t)) continue;
      if (isExp) {
        if (!this.expenseOnly(t)) continue;
      } else {
        if (!this.incomeOnly(t)) continue;
      }
      if ((t.categoria || 'Sin categoría') !== cat) continue;
      const m = (t.dt_date || '').slice(0, 7);
      const sub = (t.subcategoria || '').toString().trim() || 'Sin subcategoría';
      const add = isExp ? Math.abs(t.importe || 0) : (t.importe || 0);
      if (!subMonthlyMaps.has(sub)) subMonthlyMaps.set(sub, new Map());
      const mm = subMonthlyMaps.get(sub)!;
      mm.set(m, (mm.get(m) || 0) + add);
    }

    const monthLabelsShort = monthKeysOrder.map(k => {
      const [y, m] = k.split('-').map(Number);
      return `${String(m).padStart(2, '0')}/${String(y).slice(2)}`;
    });

    const totalsBySub: { subcategoria: string; totalPeriod: number }[] = [];
    for (const [sub, mm] of subMonthlyMaps) {
      const totalPeriod = Array.from(mm.values()).reduce((a, b) => a + b, 0);
      if (totalPeriod > 0) totalsBySub.push({ subcategoria: sub, totalPeriod });
    }
    totalsBySub.sort((a, b) => b.totalPeriod - a.totalPeriod);

    const maxLines = 12;
    const seriesForChart = totalsBySub.slice(0, maxLines).map((r, idx) => {
      const mm = subMonthlyMaps.get(r.subcategoria)!;
      const values = monthKeysOrder.map(k => mm.get(k) ?? 0);
      const sumPeriod = Array.from(mm.values()).reduce((a, b) => a + b, 0);
      const monthsWithData = mm.size;
      const avgPerMonth = monthsWithData > 0 ? sumPeriod / monthsWithData : 0;
      const hue = (idx * 47 + 18) % 360;
      return {
        subcategoria: r.subcategoria,
        values,
        color: `hsl(${hue}, 62%, 42%)`,
        avgPerMonth
      };
    });
    let lineMax = 0;
    for (const s of seriesForChart) {
      for (const v of s.values) {
        if (v > lineMax) lineMax = v;
      }
      if (s.avgPerMonth > lineMax) lineMax = s.avgPerMonth;
    }
    this.categoryDetailSubLineChart =
      seriesForChart.length > 0 && monthLabelsShort.length > 0
        ? {
            monthLabels: monthLabelsShort,
            series: seriesForChart,
            maxAmount: Math.max(1, lineMax)
          }
        : null;
  }

  closeCategoryDetail(): void {
    this.categoryDetailOpen = false;
    this.categoryDetailViewMode = 'categoria';
    this.categoryDetailSubLineChart = null;
  }

  openCategoryChartModal(isExpense: boolean, monthKey: string): void {
    this.categoryChartModalIsExpense = isExpense;
    this.selectedCategoryChartMonthKey = monthKey || '';
    this.categoryChartModalOpen = true;
  }

  closeCategoryChartModal(): void {
    this.categoryChartModalOpen = false;
  }

  /** Mes seleccionado: etiqueta para el título del modal */
  getSelectedCategoryChartMonthLabel(): string {
    const bars = this.categoryChartModalIsExpense ? this.monthlyBars : this.incomeBars;
    const hit = bars.find(b => b.monthKey === this.selectedCategoryChartMonthKey);
    return hit?.label || '';
  }

  /** Barras por categoría para el mes seleccionado en el popup */
  getCategoryChartBarsForMonth(): { categoria: string; total: number; heightPct: number }[] {
    const key = this.selectedCategoryChartMonthKey;
    if (!key) return [];
    const isExp = this.categoryChartModalIsExpense;
    const categories = isExp ? this.categoryAnalysisExpenses.map(r => r.categoria) : this.categoryAnalysisIncome.map(r => r.categoria);
    const series = isExp ? this.categoryMonthlySeriesExpenses : this.categoryMonthlySeriesIncome;
    const rows: { categoria: string; total: number }[] = categories.map(cat => ({
      categoria: cat,
      total: series[cat]?.get(key) ?? 0
    }));
    const max = rows.length ? Math.max(...rows.map(r => r.total), 1) : 1;
    return rows
      .filter(r => r.total > 0)
      .sort((a, b) => b.total - a.total)
      .map(r => ({ ...r, heightPct: Math.min(100, (r.total / max) * 100) }));
  }
}
