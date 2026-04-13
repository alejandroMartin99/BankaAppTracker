import { formatDate, formatNumber } from '@angular/common';
import { Component, ElementRef, HostListener, OnInit, ViewChild, inject, LOCALE_ID } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { trigger, transition, style, animate } from '@angular/animations';
import { forkJoin } from 'rxjs';
import {
  BenchmarkClasificacion,
  BenchmarkItem,
  BenchmarkPeriod,
  BenchmarkPoint,
  BenchmarksResponse,
  FundDetailResponse,
  InvestmentFundsResponse,
  InvestmentService,
} from '../../services/investment.service';

const CHART_COLORS = [
  '#111827',
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#db2777',
  '#0891b2',
  '#ca8a04',
  '#4b5563',
];

interface ChartSeriesRow {
  seriesKey: string;
  isin: string;
  name: string;
  color: string;
  path: string;
}

/** Línea de rejilla horizontal alineada a un % redondeado, con etiqueta para el eje Y. */
interface YGridLine {
  y: number;
  pct: number;
  label: string;
}

interface DetailGroup {
  key: BenchmarkClasificacion;
  label: string;
  rows: BenchmarkItem[];
}

/** Fila del diagrama de barras de sectores (modal ficha). */
interface FundDetailSectorBar {
  key: string;
  label: string;
  /** Ancho de la barra respecto al sector mayor (0–100). */
  barFill: number;
  pctLabel: string;
}

/** Sectores + ratings de bonos calculados una vez para el bloque Composición. */
interface FundDetailCompositionSection {
  sectorBars: FundDetailSectorBar[];
  bondRows: { key: string; value: unknown }[];
  hasContent: boolean;
}

interface ChartLegendEntry {
  seriesKey: string;
  isin: string;
  name: string;
  color: string;
  category: BenchmarkClasificacion;
  visible: boolean;
}

/** Geometría y series alineadas para crosshair / eje X. */
interface ChartXTick {
  i: number;
  x: number;
  label: string;
}

interface ChartPlotModel {
  dates: string[];
  n: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  ymin: number;
  ymax: number;
  series: { seriesKey: string; name: string; color: string; values: (number | null)[] }[];
  /** Marcas del eje X (fechas), solo reparto horizontal; la escala Y no cambia. */
  xTicks: ChartXTick[];
}

interface CrosshairTip {
  seriesKey: string;
  name: string;
  shortName: string;
  pctLabel: string;
  color: string;
  /** Posición Y de la etiqueta (coord. viewBox), tras evitar solapes. */
  labelY: number;
  /** Posición Y del punto en la serie. */
  pointY: number;
  /** Recuadro difuminado (coords. absolutas viewBox). */
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
  textPadX: number;
  tipTextAnchor: 'start' | 'end';
  tipTextX: number;
}

@Component({
  selector: 'app-inversion',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inversion.component.html',
  styleUrl: './inversion.component.scss',
  animations: [
    trigger('loaderOverlay', [
      transition(':enter', [style({ opacity: 0 }), animate('200ms ease-out', style({ opacity: 1 }))]),
      transition(':leave', [animate('180ms ease-in', style({ opacity: 0 }))]),
    ]),
  ],
})
export class InversionComponent implements OnInit {
  private readonly investment = inject(InvestmentService);
  private readonly locale = inject(LOCALE_ID);
  private readonly hostRef = inject(ElementRef<HTMLElement>);

  @ViewChild('chartSvg', { read: ElementRef }) chartSvgRef?: ElementRef<SVGSVGElement>;

  /** Altura del viewBox: ratio vertical con el ancho (debe coincidir con `aspect-ratio` de `.chart-svg` en SCSS). */
  private static readonly CHART_ASPECT_H = 7.85;
  private static readonly CHART_VB_H = (100 * InversionComponent.CHART_ASPECT_H) / 16;
  readonly chartViewBox = `0 0 100 ${InversionComponent.CHART_VB_H}`;
  /** Escala Y respecto al layout histórico 0–100 (tipografía/márgenes bajo el trazado). */
  readonly chartSvgYScale = InversionComponent.CHART_VB_H / 100;

  readonly chartPadL = 10.25;
  /** Margen derecho del trazado (eje X / etiquetas). */
  readonly chartPadR = 1.25;
  readonly chartPadT = 15;
  readonly chartPadB = 13.5;

  period: BenchmarkPeriod = 'ytd';
  periodPresets: { id: BenchmarkPeriod; label: string }[] = [
    { id: 'ytd', label: 'YTD' },
    { id: '1m', label: '1M' },
    { id: '6m', label: '6M' },
    { id: '1y', label: '1Y' },
    { id: '3y', label: '3Y' },
    { id: '5y', label: '5Y' },
    { id: 'max', label: 'MAX' },
  ];

  loading = false;
  showLoader = false;
  error: string | null = null;
  loadAttempted = false;
  items: BenchmarkItem[] = [];
  cryptoItems: BenchmarkItem[] = [];
  errors: { isin: string; detail: string }[] = [];
  cryptoErrors: { symbol: string; detail: string }[] = [];

  chartSeries: ChartSeriesRow[] = [];
  yGridLines: YGridLine[] = [];
  chartPlot: ChartPlotModel | null = null;

  /** Índice de fecha bajo el cursor / arrastre (null = oculto). */
  crosshairIndex: number | null = null;
  private crosshairDragging = false;

  /** Series ocultas en el gráfico (solo vista; los datos siguen en memoria). */
  hiddenSeriesKeys: string[] = [];

  /** Respuestas de benchmarks por periodo ya descargadas (sin repetir HTTP). */
  private benchmarksCache: Partial<Record<BenchmarkPeriod, BenchmarksResponse>> = {};

  /** Color estable por serie para la respuesta actual. */
  private seriesColorByKey = new Map<string, string>();

  /** Categorías con chip en el gráfico (solo se listan las que tengan series). */
  readonly chartCategoryDefs: { key: BenchmarkClasificacion; label: string }[] = [
    { key: 'fondos_monetarios', label: 'Monetarios' },
    { key: 'renta_fija', label: 'Renta fija' },
    { key: 'renta_variable', label: 'Renta variable' },
    { key: 'criptoactivos', label: 'Cripto' },
  ];

  /** Clasificación de filas de fondo (no incluye cripto; el cripto va siempre al grupo criptoactivos). */
  private readonly fundClasificacionKeys = new Set<string>([
    'fondos_monetarios',
    'renta_fija',
    'renta_variable',
  ]);

  /** Orden en detalle: monetarios → RF → RV → cripto */
  readonly detailSectionOrder: { key: BenchmarkClasificacion; label: string }[] = [
    { key: 'fondos_monetarios', label: 'Fondos monetarios' },
    { key: 'renta_fija', label: 'Renta fija' },
    { key: 'renta_variable', label: 'Renta variable' },
    { key: 'criptoactivos', label: 'Criptoactivos' },
  ];
  detailGroups: DetailGroup[] = [];

  watchlistRows: { isin: string; sort_order?: number; created_at?: string }[] = [];
  usingDefaultWatchlist = true;
  maxFunds = 40;
  newIsin = '';
  fundError: string | null = null;

  /** Modal ficha ampliada (API + caché servidor). */
  fundDetailOpen = false;
  fundDetailTitle = '';
  fundDetailLoading = false;
  fundDetailError: string | null = null;
  fundDetailResponse: FundDetailResponse | null = null;

  ngOnInit(): void {
    this.load();
  }

  get periodLabel(): string {
    const m: Record<BenchmarkPeriod, string> = {
      ytd: 'YTD',
      '1m': '1M',
      '6m': '6M',
      '1y': '1Y',
      '3y': '3Y',
      '5y': '5Y',
      max: 'MAX',
    };
    return m[this.period];
  }

  get hasBenchmarkSeries(): boolean {
    return this.items.length > 0 || this.cryptoItems.length > 0;
  }

  get hasVisibleChartSeries(): boolean {
    if (!this.hasBenchmarkSeries) return false;
    const hidden = new Set(this.hiddenSeriesKeys);
    for (const it of [...this.items, ...this.cryptoItems]) {
      if (!hidden.has(this.seriesKeyFor(it))) return true;
    }
    return false;
  }

  get chartCategoriesInData(): { key: BenchmarkClasificacion; label: string }[] {
    const withKeys = this.chartCategoryDefs.filter((d) => this.keysForCategory(d.key).length > 0);
    return withKeys;
  }

  get chartLegendEntries(): ChartLegendEntry[] {
    const hidden = new Set(this.hiddenSeriesKeys);
    const out: ChartLegendEntry[] = [];
    for (const it of this.items) {
      const seriesKey = this.seriesKeyFor(it);
      out.push({
        seriesKey,
        isin: it.isin || '',
        name: it.name,
        color: this.seriesColorByKey.get(seriesKey) ?? CHART_COLORS[0],
        category: this.effectiveClasificacion(it),
        visible: !hidden.has(seriesKey),
      });
    }
    for (const it of this.cryptoItems) {
      const seriesKey = this.seriesKeyFor(it);
      out.push({
        seriesKey,
        isin: '',
        name: it.name,
        color: this.seriesColorByKey.get(seriesKey) ?? CHART_COLORS[0],
        category: 'criptoactivos',
        visible: !hidden.has(seriesKey),
      });
    }
    return out.sort((a, b) =>
      a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
    );
  }

  get chartDateRangeShort(): string {
    const p = this.chartPlot;
    if (!p || p.dates.length === 0) return '';
    const a = this.formatChartTipDate(p.dates[0]);
    const b = this.formatChartTipDate(p.dates[p.dates.length - 1]);
    return `${a} → ${b}`;
  }

  get crosshairX(): number {
    const p = this.chartPlot;
    if (!p || this.crosshairIndex == null) return p?.plotLeft ?? this.chartPadL;
    return this.chartXAt(p, this.crosshairIndex);
  }

  get crosshairDateLabel(): string {
    const p = this.chartPlot;
    if (!p || this.crosshairIndex == null) return '';
    return this.formatChartTipDate(p.dates[this.crosshairIndex]);
  }

  get crosshairTips(): CrosshairTip[] {
    const p = this.chartPlot;
    if (!p || this.crosshairIndex == null) return [];
    const idx = this.crosshairIndex;
    const xLine = this.crosshairX;
    const raw: {
      seriesKey: string;
      name: string;
      shortName: string;
      pctLabel: string;
      color: string;
      pointY: number;
    }[] = [];
    for (const s of p.series) {
      const v = s.values[idx];
      if (v == null) continue;
      raw.push({
        seriesKey: s.seriesKey,
        name: s.name,
        shortName: InversionComponent.truncateCrosshairName(s.name),
        pctLabel: InversionComponent.formatTipPct(v),
        color: s.color,
        pointY: this.chartYAt(p, v),
      });
    }
    raw.sort((a, b) => a.pointY - b.pointY);
    const sy = this.chartSvgYScale;
    const gap = 2.85 * sy;
    let prevBottom = -1e9;
    const boxH = 3.55 * sy;
    const textPadX = 0.95;
    const charW = 0.52;
    const margin = 0.75;

    type Pre = typeof raw[number] & {
      labelY: number;
      boxW: number;
      boxY: number;
    };
    const prelims: Pre[] = [];
    for (const r of raw) {
      let labelY = r.pointY;
      if (labelY < prevBottom + gap) labelY = prevBottom + gap;
      const maxY = p.plotBottom - 2 * sy;
      if (labelY > maxY) labelY = maxY;
      const line = `${r.pctLabel} · ${r.shortName}`;
      const boxW = Math.min(48, Math.max(13, line.length * charW + textPadX * 2));
      let boxY = labelY - boxH / 2;
      if (boxY < p.plotTop + 0.3) boxY = p.plotTop + 0.3;
      if (boxY + boxH > p.plotBottom - 0.3) boxY = p.plotBottom - boxH - 0.3;
      prelims.push({ ...r, labelY, boxW, boxY });
      prevBottom = labelY + gap * 0.38;
    }

    const maxBoxW = Math.max(13, ...prelims.map((q) => q.boxW));
    const spaceLeft = xLine - p.plotLeft - margin;
    const spaceRight = p.plotRight - xLine - margin;

    let placeRight: boolean;
    if (spaceRight >= maxBoxW && spaceLeft >= maxBoxW) {
      placeRight = spaceRight >= spaceLeft;
    } else if (spaceRight >= maxBoxW) {
      placeRight = true;
    } else if (spaceLeft >= maxBoxW) {
      placeRight = false;
    } else {
      placeRight = spaceRight >= spaceLeft;
    }

    const out: CrosshairTip[] = [];
    for (const pr of prelims) {
      let boxX: number;
      let tipTextAnchor: 'start' | 'end';
      let tipTextX: number;
      if (placeRight) {
        boxX = xLine + margin;
        if (boxX + pr.boxW > p.plotRight - 0.2) {
          boxX = Math.max(p.plotLeft + 0.2, p.plotRight - pr.boxW - 0.2);
        }
        tipTextAnchor = 'start';
        tipTextX = textPadX;
      } else {
        boxX = xLine - margin - pr.boxW;
        if (boxX < p.plotLeft + 0.2) {
          boxX = p.plotLeft + 0.2;
        }
        tipTextAnchor = 'end';
        tipTextX = pr.boxW - textPadX;
      }
      out.push({
        seriesKey: pr.seriesKey,
        name: pr.name,
        shortName: pr.shortName,
        pctLabel: pr.pctLabel,
        color: pr.color,
        labelY: pr.labelY,
        pointY: pr.pointY,
        boxX,
        boxY: pr.boxY,
        boxW: pr.boxW,
        boxH,
        textPadX,
        tipTextAnchor,
        tipTextX,
      });
    }
    return out;
  }

  @HostListener('document:mousemove', ['$event'])
  onDocumentMouseMove(ev: MouseEvent): void {
    if (!this.crosshairDragging) return;
    const svg = this.chartSvgRef?.nativeElement;
    if (!svg) return;
    this.updateCrosshairFromClientX(svg, ev.clientX);
  }

  @HostListener('document:mouseup')
  onDocumentMouseUp(): void {
    this.crosshairDragging = false;
  }

  onChartMouseDown(ev: MouseEvent): void {
    if (!this.chartPlot || !this.hasVisibleChartSeries) return;
    ev.preventDefault();
    this.crosshairDragging = true;
    const svg = this.chartSvgRef?.nativeElement;
    if (svg) this.updateCrosshairFromClientX(svg, ev.clientX);
  }

  onChartMouseMove(ev: MouseEvent): void {
    if (!this.chartPlot || !this.hasVisibleChartSeries) return;
    if (this.crosshairDragging) return;
    const svg = this.chartSvgRef?.nativeElement;
    if (svg) this.updateCrosshairFromClientX(svg, ev.clientX);
  }

  onChartMouseLeave(): void {
    if (this.crosshairDragging) return;
    this.crosshairIndex = null;
  }

  onChartTouchStart(ev: TouchEvent): void {
    if (!this.chartPlot || !this.hasVisibleChartSeries) return;
    const t = ev.touches[0];
    const svg = this.chartSvgRef?.nativeElement;
    if (!svg || !t) return;
    this.crosshairDragging = true;
    this.updateCrosshairFromClientX(svg, t.clientX);
  }

  onChartTouchMove(ev: TouchEvent): void {
    if (!this.crosshairDragging) return;
    const t = ev.touches[0];
    const svg = this.chartSvgRef?.nativeElement;
    if (!svg || !t) return;
    ev.preventDefault();
    this.updateCrosshairFromClientX(svg, t.clientX);
  }

  onChartTouchEnd(): void {
    this.crosshairDragging = false;
  }

  setSeriesVisible(seriesKey: string, visible: boolean): void {
    const h = new Set(this.hiddenSeriesKeys);
    if (visible) h.delete(seriesKey);
    else h.add(seriesKey);
    this.hiddenSeriesKeys = [...h];
    this.rebuildChart();
  }

  private updateCrosshairFromClientX(svg: SVGSVGElement, clientX: number): void {
    const p = this.chartPlot;
    if (!p || p.n === 0) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;
    const vb = svg.viewBox.baseVal;
    const xUs = ((clientX - rect.left) / rect.width) * vb.width;
    const clamped = Math.min(p.plotRight, Math.max(p.plotLeft, xUs));
    const t = p.n <= 1 ? 0 : (clamped - p.plotLeft) / (p.plotRight - p.plotLeft);
    const idx = Math.round(t * (p.n - 1));
    this.crosshairIndex = Math.min(p.n - 1, Math.max(0, idx));
  }

  private chartXAt(p: ChartPlotModel, i: number): number {
    return p.n <= 1 ? p.plotLeft + (p.plotRight - p.plotLeft) / 2 : p.plotLeft + (i / (p.n - 1)) * (p.plotRight - p.plotLeft);
  }

  private chartYAt(p: ChartPlotModel, v: number): number {
    const plotH = p.plotBottom - p.plotTop;
    return p.plotTop + ((p.ymax - v) / (p.ymax - p.ymin)) * plotH;
  }

  private formatChartTipDate(iso: string): string {
    try {
      const d = new Date(iso.includes('T') ? iso : `${iso}T12:00:00`);
      return formatDate(d, 'd MMM yy', this.locale);
    } catch {
      return iso;
    }
  }

  /**
   * Etiquetas del eje X: con poco rango temporal se muestra el día; si no, solo mes (+ año).
   */
  private formatChartAxisTickLabel(iso: string, rangeStart: Date, rangeEnd: Date): string {
    try {
      const d = new Date(iso.includes('T') ? iso : `${iso}T12:00:00`);
      const spanDays = Math.max(0, (rangeEnd.getTime() - rangeStart.getTime()) / 86400000);
      const sameYear = rangeStart.getFullYear() === rangeEnd.getFullYear();
      /** Por debajo de ~7 semanas priorizamos día + mes para lectura fina. */
      if (spanDays <= 50) {
        return formatDate(d, sameYear ? 'd MMM' : 'd MMM yy', this.locale);
      }
      return formatDate(d, 'MMM yy', this.locale);
    } catch {
      return iso;
    }
  }

  private static formatTipPct(v: number): string {
    const x = Math.round(v * 100) / 100;
    if (Math.abs(x) < 1e-9) return '0%';
    if (x < 0) return `${x}%`;
    return `+${x}%`;
  }

  private static truncateCrosshairName(name: string, max = 26): string {
    const t = (name || '').trim();
    if (t.length <= max) return t;
    return `${t.slice(0, max - 1)}…`;
  }

  setPeriod(p: BenchmarkPeriod): void {
    if (this.period === p) return;
    this.period = p;
    const cached = this.benchmarksCache[p];
    if (cached) {
      this.applyBenchmarkResponse(cached);
      return;
    }
    this.loadBenchmarksOnly();
  }

  seriesKeyFor(it: BenchmarkItem): string {
    return it.isin && it.isin.trim() ? it.isin : it.symbol;
  }

  /** Peor caída desde un máximo intermedio, sobre la misma serie % vs inicio del periodo. */
  detailMaxDrawdownPct(row: BenchmarkItem): number | null {
    return InversionComponent.computeMaxDrawdownPct(row.points);
  }

  /** Volatilidad anualizada aproximada (%), retornos entre puntos y calendario entre fechas. */
  detailAnnualizedVolatilityPct(row: BenchmarkItem): number | null {
    return InversionComponent.computeAnnualizedVolatilityPct(row.points);
  }

  categoryChipState(cat: BenchmarkClasificacion): 'all' | 'none' | 'partial' {
    const keys = this.keysForCategory(cat);
    if (keys.length === 0) return 'none';
    let vis = 0;
    for (const k of keys) {
      if (!this.hiddenSeriesKeys.includes(k)) vis++;
    }
    if (vis === 0) return 'none';
    if (vis === keys.length) return 'all';
    return 'partial';
  }

  toggleCategoryVisibility(cat: BenchmarkClasificacion): void {
    const keys = this.keysForCategory(cat);
    if (keys.length === 0) return;
    const keySet = new Set(keys);
    const allVisible = keys.every((k) => !this.hiddenSeriesKeys.includes(k));
    let next: string[];
    if (allVisible) {
      const h = new Set(this.hiddenSeriesKeys);
      for (const k of keys) h.add(k);
      next = [...h];
    } else {
      next = this.hiddenSeriesKeys.filter((k) => !keySet.has(k));
    }
    this.hiddenSeriesKeys = next;
    this.rebuildChart();
  }

  showAllChartSeries(): void {
    this.hiddenSeriesKeys = [];
    this.rebuildChart();
  }

  load(): void {
    this.loading = true;
    this.showLoader = true;
    this.error = null;
    this.fundError = null;
    forkJoin({
      funds: this.investment.getFunds(),
      bench: this.investment.getBenchmarks(this.period),
    }).subscribe({
      next: ({ funds, bench }) => {
        this.applyFundsResponse(funds);
        this.benchmarksCache[this.period] = bench;
        this.applyBenchmarkResponse(bench);
        this.loading = false;
        this.showLoader = false;
      },
      error: (err) => {
        this.loadAttempted = true;
        this.benchmarksCache = {};
        this.items = [];
        this.cryptoItems = [];
        this.errors = [];
        this.cryptoErrors = [];
        this.chartSeries = [];
        this.detailGroups = [];
        this.watchlistRows = [];
        const st = err.status;
        this.error =
          st === 401
            ? 'Inicia sesión para ver Inversión y gestionar tus fondos.'
            : err.error?.detail || 'Error al cargar. ¿Backend en marcha?';
        this.loading = false;
        this.showLoader = false;
      },
    });
  }

  loadBenchmarksOnly(): void {
    this.loading = true;
    this.showLoader = true;
    this.error = null;
    this.investment.getBenchmarks(this.period).subscribe({
      next: (res) => {
        this.benchmarksCache[this.period] = res;
        this.applyBenchmarkResponse(res);
        this.loading = false;
        this.showLoader = false;
      },
      error: (err) => {
        this.items = [];
        this.cryptoItems = [];
        this.errors = [];
        this.cryptoErrors = [];
        this.chartSeries = [];
        this.detailGroups = [];
        this.error =
          err.status === 401
            ? 'Inicia sesión para ver Inversión.'
            : err.error?.detail || 'Error al cargar benchmarks.';
        this.loading = false;
        this.showLoader = false;
      },
    });
  }

  submitNewFund(): void {
    this.fundError = null;
    const raw = this.newIsin.trim().toUpperCase();
    if (raw.length !== 12) {
      this.fundError = 'El ISIN debe tener 12 caracteres.';
      return;
    }
    this.investment.addFund(raw).subscribe({
      next: () => {
        this.newIsin = '';
        this.refreshFundsAndBenchmarks();
      },
      error: (err) => {
        this.fundError = err.error?.detail || 'No se pudo añadir el ISIN.';
      },
    });
  }

  removeFund(isin: string): void {
    this.fundError = null;
    this.investment.removeFund(isin).subscribe({
      next: () => this.refreshFundsAndBenchmarks(),
      error: (err) => {
        this.fundError = err.error?.detail || 'No se pudo eliminar.';
      },
    });
  }

  private refreshFundsAndBenchmarks(): void {
    this.benchmarksCache = {};
    forkJoin({
      funds: this.investment.getFunds(),
      bench: this.investment.getBenchmarks(this.period),
    }).subscribe({
      next: ({ funds, bench }) => {
        this.applyFundsResponse(funds);
        this.benchmarksCache[this.period] = bench;
        this.applyBenchmarkResponse(bench);
      },
      error: (err) => {
        this.fundError = err.error?.detail || 'Error al actualizar la lista.';
      },
    });
  }

  private applyFundsResponse(f: InvestmentFundsResponse): void {
    this.watchlistRows = Array.isArray(f.items) ? f.items : [];
    this.maxFunds = typeof f.max_funds === 'number' ? f.max_funds : 40;
  }

  private applyBenchmarkResponse(res: BenchmarksResponse): void {
    this.loadAttempted = true;
    this.items = Array.isArray(res.items) ? res.items : [];
    this.cryptoItems = Array.isArray(res.crypto_items) ? res.crypto_items : [];
    this.errors = Array.isArray(res.errors) ? res.errors : [];
    this.cryptoErrors = Array.isArray(res.crypto_errors) ? res.crypto_errors : [];
    this.usingDefaultWatchlist = res.using_default_watchlist ?? true;
    this.pruneHiddenSeriesKeys();
    this.refreshSeriesColorMap();
    this.rebuildChart();
    this.rebuildDetailGroups();
  }

  private effectiveClasificacion(row: BenchmarkItem): BenchmarkClasificacion {
    const raw = row.clasificacion;
    if (raw && this.fundClasificacionKeys.has(raw as string)) {
      return raw as BenchmarkClasificacion;
    }
    return 'renta_variable';
  }

  /** Serie % vs inicio: máximo (peak − valor) en puntos sucesivos. */
  private static computeMaxDrawdownPct(points: BenchmarkPoint[] | undefined): number | null {
    if (!points?.length) return null;
    let peak = -Infinity;
    let maxDd = 0;
    for (const p of points) {
      const v = p.pct_vs_start;
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (v > peak) peak = v;
      const dd = peak - v;
      if (dd > maxDd) maxDd = dd;
    }
    if (!Number.isFinite(peak)) return null;
    return maxDd;
  }

  /**
   * σ anualizada aproximada: retornos simples entre puntos consecutivos (desde % acumulado)
   * y escalado con el intervalo medio en días (365,25 d/año).
   */
  private static computeAnnualizedVolatilityPct(points: BenchmarkPoint[] | undefined): number | null {
    if (!points || points.length < 3) return null;
    const rets: number[] = [];
    const gapsDays: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1].pct_vs_start;
      const curr = points[i].pct_vs_start;
      if (typeof prev !== 'number' || typeof curr !== 'number' || !Number.isFinite(prev) || !Number.isFinite(curr)) {
        continue;
      }
      const r0 = 1 + prev / 100;
      const r1 = 1 + curr / 100;
      if (r0 <= 0) continue;
      rets.push(r1 / r0 - 1);
      const t0 = Date.parse(points[i - 1].date);
      const t1 = Date.parse(points[i].date);
      if (Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0) {
        gapsDays.push(Math.max((t1 - t0) / 86400000, 1e-6));
      }
    }
    if (rets.length < 2) return null;
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    let sumSq = 0;
    for (const r of rets) sumSq += (r - mean) ** 2;
    const variance = sumSq / (rets.length - 1);
    const sigma = Math.sqrt(variance);
    const avgDays = gapsDays.length > 0 ? gapsDays.reduce((a, b) => a + b, 0) / gapsDays.length : 1;
    const ann = sigma * Math.sqrt(365.25 / avgDays) * 100;
    return Number.isFinite(ann) && ann >= 0 ? ann : null;
  }

  /** Dentro de cada categoría: mayor rentabilidad primero; sin dato al final; empate por nombre. */
  private static sortDetailRowsByReturnDesc(a: BenchmarkItem, b: BenchmarkItem): number {
    const ra = a.total_return_pct;
    const rb = b.total_return_pct;
    const na = ra == null || !Number.isFinite(ra);
    const nb = rb == null || !Number.isFinite(rb);
    if (na && nb) {
      return (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' });
    }
    if (na) return 1;
    if (nb) return -1;
    if (rb !== ra) return rb - ra;
    return (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' });
  }

  /** Etiqueta del eje Y (% vs inicio del periodo) para rejilla horizontal. */
  /** Índices de fecha repartidos en el ancho del gráfico (eje X). */
  private static buildXAxisTicks(
    dates: string[],
    n: number,
    xAt: (i: number) => number,
    formatLabel: (iso: string) => string,
  ): ChartXTick[] {
    if (n <= 0) return [];
    const maxTicks = 7;
    const idx = new Set<number>();
    if (n === 1) {
      idx.add(0);
    } else if (n <= maxTicks) {
      for (let i = 0; i < n; i++) idx.add(i);
    } else {
      for (let t = 0; t < maxTicks; t++) {
        idx.add(Math.round((t / (maxTicks - 1)) * (n - 1)));
      }
    }
    return [...idx]
      .sort((a, b) => a - b)
      .map((i) => ({ i, x: xAt(i), label: formatLabel(dates[i]) }));
  }

  private static formatYGridLabel(pct: number): string {
    const v = Math.round(pct * 100) / 100;
    if (Math.abs(v) < 1e-9) return '0%';
    if (v < 0) return `${v}%`;
    return `+${v}%`;
  }

  private keysForCategory(cat: BenchmarkClasificacion): string[] {
    if (cat === 'criptoactivos') {
      return this.cryptoItems.map((it) => this.seriesKeyFor(it));
    }
    return this.items.filter((it) => this.effectiveClasificacion(it) === cat).map((it) => this.seriesKeyFor(it));
  }

  private pruneHiddenSeriesKeys(): void {
    const allowed = new Set(
      [...this.items, ...this.cryptoItems].map((it) => this.seriesKeyFor(it)),
    );
    this.hiddenSeriesKeys = this.hiddenSeriesKeys.filter((k) => allowed.has(k));
  }

  private refreshSeriesColorMap(): void {
    const order = [...this.items, ...this.cryptoItems];
    const next = new Map<string, string>();
    let colorIdx = 0;
    for (const it of order) {
      const k = this.seriesKeyFor(it);
      if (!next.has(k)) {
        next.set(k, CHART_COLORS[colorIdx % CHART_COLORS.length]);
        colorIdx++;
      }
    }
    this.seriesColorByKey = next;
  }

  private rebuildDetailGroups(): void {
    const buckets = new Map<BenchmarkClasificacion, BenchmarkItem[]>();
    for (const s of this.detailSectionOrder) {
      buckets.set(s.key, []);
    }
    for (const row of this.items) {
      const k = this.effectiveClasificacion(row);
      buckets.get(k)!.push(row);
    }
    for (const row of this.cryptoItems) {
      buckets.get('criptoactivos')!.push(row);
    }
    this.detailGroups = this.detailSectionOrder
      .map((s) => {
        const rows = [...(buckets.get(s.key) || [])].sort(InversionComponent.sortDetailRowsByReturnDesc);
        return { key: s.key, label: s.label, rows };
      })
      .filter((g) => g.rows.length > 0);
  }

  private rebuildChart(): void {
    const savedCrossIdx = this.crosshairIndex;
    const hidden = new Set(this.hiddenSeriesKeys);
    const full = [...this.items, ...this.cryptoItems];
    const seriesRows = full.filter((it) => !hidden.has(this.seriesKeyFor(it)));
    if (seriesRows.length === 0) {
      this.chartSeries = [];
      this.yGridLines = [];
      this.chartPlot = null;
      this.crosshairIndex = null;
      return;
    }

    const dateSet = new Set<string>();
    for (const it of seriesRows) {
      for (const p of it.points) dateSet.add(p.date);
    }
    const dates = [...dateSet].sort();

    const aligned: {
      seriesKey: string;
      isin: string;
      name: string;
      color: string;
      values: (number | null)[];
    }[] = seriesRows.map((it) => {
      const m = new Map(it.points.map((p) => [p.date, p.pct_vs_start]));
      const values: (number | null)[] = [];
      let last: number | null = null;
      for (const d of dates) {
        if (m.has(d)) last = m.get(d)!;
        values.push(last);
      }
      const seriesKey = this.seriesKeyFor(it);
      return {
        seriesKey,
        isin: it.isin || '',
        name: it.name,
        color: this.seriesColorByKey.get(seriesKey) ?? CHART_COLORS[0],
        values,
      };
    });

    let ymin = Infinity;
    let ymax = -Infinity;
    for (const s of aligned) {
      for (const v of s.values) {
        if (v == null) continue;
        ymin = Math.min(ymin, v);
        ymax = Math.max(ymax, v);
      }
    }
    if (!Number.isFinite(ymin) || !Number.isFinite(ymax)) {
      this.chartSeries = [];
      this.yGridLines = [];
      this.chartPlot = null;
      this.crosshairIndex = null;
      return;
    }
    if (ymin === ymax) {
      ymin -= 2;
      ymax += 2;
    }
    const pad = (ymax - ymin) * 0.06;
    ymin -= pad;
    ymax += pad;

    const sy = this.chartSvgYScale;
    const plotTop = this.chartPadT * sy;
    const plotBottom = (100 - this.chartPadB) * sy;
    const plotLeft = this.chartPadL;
    const plotRight = 100 - this.chartPadR;
    const plotH = plotBottom - plotTop;
    const plotW = plotRight - plotLeft;
    const n = dates.length;

    const yToSvg = (v: number) => plotTop + ((ymax - v) / (ymax - ymin)) * plotH;
    const xAt = (i: number) => (n <= 1 ? plotLeft + plotW / 2 : plotLeft + (i / (n - 1)) * plotW);

    const firstIso = dates[0];
    const lastIso = dates[n - 1];
    const rangeStart = new Date(firstIso.includes('T') ? firstIso : `${firstIso}T12:00:00`);
    const rangeEnd = new Date(lastIso.includes('T') ? lastIso : `${lastIso}T12:00:00`);
    const xTicks = InversionComponent.buildXAxisTicks(dates, n, xAt, (iso) =>
      this.formatChartAxisTickLabel(iso, rangeStart, rangeEnd),
    );

    const range = ymax - ymin;
    const niceStep = (r: number): number => {
      if (!Number.isFinite(r) || r <= 0) return 1;
      const pow10 = Math.pow(10, Math.floor(Math.log10(r)));
      const err = r / pow10;
      if (err <= 1) return pow10;
      if (err <= 2) return 2 * pow10;
      if (err <= 5) return 5 * pow10;
      return 10 * pow10;
    };
    const step = niceStep(range / 5) || 1;
    const gridStart = Math.floor(ymin / step) * step;
    const gridEnd = Math.ceil(ymax / step) * step;
    const gridLines: YGridLine[] = [];
    for (let v = gridStart; v <= gridEnd + step * 0.0001; v += step) {
      const rounded = Math.round(v * 100) / 100;
      const ySvg = yToSvg(v);
      gridLines.push({
        y: ySvg,
        pct: rounded,
        label: InversionComponent.formatYGridLabel(rounded),
      });
    }
    this.yGridLines = gridLines;

    this.chartSeries = aligned.map((s) => {
      const segs: string[] = [];
      let started = false;
      for (let i = 0; i < s.values.length; i++) {
        const v = s.values[i];
        if (v == null) {
          started = false;
          continue;
        }
        const x = xAt(i);
        const y = yToSvg(v);
        if (!started) {
          segs.push(`M ${x} ${y}`);
          started = true;
        } else {
          segs.push(`L ${x} ${y}`);
        }
      }
      return {
        seriesKey: s.seriesKey,
        isin: s.isin,
        name: s.name,
        color: s.color,
        path: segs.join(' '),
      };
    });

    this.chartPlot = {
      dates: [...dates],
      n,
      plotLeft,
      plotRight,
      plotTop,
      plotBottom,
      ymin,
      ymax,
      series: aligned.map((s) => ({
        seriesKey: s.seriesKey,
        name: s.name,
        color: s.color,
        values: [...s.values],
      })),
      xTicks,
    };
    if (savedCrossIdx != null && savedCrossIdx >= 0 && savedCrossIdx < n) {
      this.crosshairIndex = savedCrossIdx;
    } else {
      this.crosshairIndex = null;
    }
  }

  openFundDetail(row: BenchmarkItem, grpKey: BenchmarkClasificacion): void {
    const isCrypto = grpKey === 'criptoactivos';
    const isin = !isCrypto && row.isin?.trim() ? row.isin.trim().toUpperCase() : undefined;
    const sym = isCrypto && row.symbol?.trim() ? row.symbol.trim() : undefined;
    if (!isin && !sym) return;
    this.fundDetailOpen = true;
    this.fundDetailTitle = row.name || isin || sym || '';
    this.fundDetailLoading = true;
    this.fundDetailError = null;
    this.fundDetailResponse = null;
    this.investment.getFundDetail(isin, sym).subscribe({
      next: (r) => {
        this.fundDetailResponse = r;
        this.fundDetailLoading = false;
        if (!r.success) {
          this.fundDetailError = 'La ficha no está disponible.';
        }
      },
      error: (err: { error?: { detail?: string | string[] } }) => {
        this.fundDetailLoading = false;
        this.fundDetailError = InversionComponent.parseFundDetailHttpError(err);
      },
    });
  }

  closeFundDetail(): void {
    this.fundDetailOpen = false;
  }

  /** Cierra «Tipo» / «Fondos» al pulsar fuera del desplegable. */
  @HostListener('document:click', ['$event'])
  onDocumentClickCloseChartFilters(ev: MouseEvent): void {
    const t = ev.target;
    if (!(t instanceof Node)) return;
    for (let n: Node | null = t; n; n = n.parentNode) {
      if (n instanceof HTMLDetailsElement && n.classList.contains('chart-dd')) {
        return;
      }
    }
    this.closeOpenChartDdDetails();
  }

  private closeOpenChartDdDetails(): void {
    const nodes = this.hostRef.nativeElement.querySelectorAll('details.chart-dd[open]');
    nodes.forEach((node: Element) => {
      (node as HTMLDetailsElement).open = false;
    });
  }

  @HostListener('document:keydown.escape')
  onFundDetailEscape(): void {
    if (this.fundDetailOpen) {
      this.closeFundDetail();
    }
  }

  fundDetailInfo(): Record<string, unknown> | null {
    const inf = this.fundDetailResponse?.detail?.info;
    return inf && typeof inf === 'object' && !Array.isArray(inf) ? inf : null;
  }

  fundDetailComposition(): Record<string, unknown> | null {
    const c = this.fundDetailResponse?.detail?.composition;
    return c && typeof c === 'object' && !Array.isArray(c) ? c : null;
  }

  fundDetailObjectRows(obj: unknown): { key: string; value: unknown }[] {
    return InversionComponent.objectKeyValueRows(obj);
  }

  /** Sectores (barras) + ratings de bonos; un solo cálculo por ciclo de detección de cambios. */
  fundDetailCompositionSection(): FundDetailCompositionSection {
    const c = this.fundDetailComposition();
    const sectorBars = c ? InversionComponent.buildSectorBars(c, this.locale) : [];
    const bondRows = c ? InversionComponent.objectKeyValueRows(c['bond_ratings']) : [];
    return {
      sectorBars,
      bondRows,
      hasContent: sectorBars.length > 0 || bondRows.length > 0,
    };
  }

  /** Solo campos útiles del bloque `info` (orden fijo). */
  fundDetailEssentialInfoRows(): { key: string; label: string; value: unknown }[] {
    const info = this.fundDetailInfo();
    if (!info) return [];
    const out: { key: string; label: string; value: unknown }[] = [];
    for (const { key, label } of InversionComponent.FUND_DETAIL_ESSENTIAL_FIELDS) {
      const v = info[key];
      if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) continue;
      out.push({ key, label, value: v });
    }
    return out;
  }

  /** Descripción corta (el detalle largo va en la API pero no abrumamos el modal). */
  fundDetailShortDescription(maxChars = 420): string | null {
    const c = this.fundDetailComposition();
    const d = c?.['description'];
    if (typeof d !== 'string') return null;
    const t = d.trim();
    if (!t) return null;
    return t.length <= maxChars ? t : `${t.slice(0, maxChars).trim()}…`;
  }

  /** Top holdings: solo nombre y % cartera (columnas Yahoo pueden variar). */
  fundDetailTopHoldingsNamePercent(): { name: string; pctValue: unknown }[] {
    const c = this.fundDetailComposition();
    const raw = c?.['top_holdings'];
    const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
    if (rows.length === 0) return [];
    const { nameKey, pctKey } = InversionComponent.resolveTopHoldingsColumnKeys(Object.keys(rows[0]));
    return rows.map((r) => ({
      name: String(r[nameKey] ?? '—'),
      pctValue: pctKey != null ? r[pctKey] : null,
    }));
  }

  private static readonly FUND_DETAIL_ESSENTIAL_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
    { key: 'category', label: 'Categoría' },
    { key: 'fundFamily', label: 'Familia del fondo' },
    { key: 'currency', label: 'Divisa' },
    { key: 'legalType', label: 'Tipo legal' },
    { key: 'fullExchangeName', label: 'Mercado' },
    { key: 'totalAssets', label: 'Activos totales' },
    { key: 'yield', label: 'Yield' },
    { key: 'ytdReturn', label: 'Rentabilidad YTD' },
    { key: 'annualReportExpenseRatio', label: 'Ratio de gastos (TER)' },
    { key: 'fundInceptionDate', label: 'Fecha de lanzamiento' },
    { key: 'morningStarOverallRating', label: 'Morningstar (valoración)' },
    { key: 'morningStarRiskRating', label: 'Morningstar (riesgo)' },
  ];

  private static formatFundDetailScalar(v: unknown): string {
    if (v == null) return '—';
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (typeof v === 'object') {
      try {
        return JSON.stringify(v);
      } catch {
        return '—';
      }
    }
    return String(v);
  }

  /** Pesos sector / clase activo / rating: Yahoo suele mandar fracción 0–1 o ya en %. */
  formatFundWeightValue(v: unknown): string {
    if (typeof v === 'number' && Number.isFinite(v)) {
      const pct = InversionComponent.normalizeYahooFractionToPercent(v);
      return `${formatNumber(pct, this.locale, '1.2-2')}%`;
    }
    return InversionComponent.formatFundDetailScalar(v);
  }

  /** Celdas de tablas de participaciones / operaciones (columna = nombre campo Yahoo). */
  formatFundTableCell(columnKey: string, v: unknown): string {
    if (v == null) return '—';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (typeof v === 'string') {
      const t = v.trim();
      if (/^-?\d+(\.\d+)?$/.test(t)) {
        const n = Number(t);
        if (Number.isFinite(n)) {
          return InversionComponent.formatFundNumericCell(this.locale, columnKey, n);
        }
      }
      return t.length > 160 ? `${t.slice(0, 160)}…` : t;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      return InversionComponent.formatFundNumericCell(this.locale, columnKey, v);
    }
    if (typeof v === 'object') {
      try {
        const s = JSON.stringify(v);
        return s.length > 120 ? `${s.slice(0, 120)}…` : s;
      } catch {
        return '—';
      }
    }
    return String(v);
  }

  /** Campos del bloque `info` de Yahoo (clave camelCase). */
  formatFundInfoValue(infoKey: string, v: unknown): string {
    if (v == null) return '—';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (typeof v === 'string') {
      return v.length > 200 ? `${v.slice(0, 200)}…` : v;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      const k = infoKey.toLowerCase();
      if (/morning|starrating|riskrating/.test(k)) {
        return formatNumber(v, this.locale, '1.0-0');
      }
      if (InversionComponent.fundInfoKeyIsPercent(infoKey)) {
        return InversionComponent.formatPercentFromYahooNumber(this.locale, infoKey, v);
      }
      return formatNumber(v, this.locale, '1.2-2');
    }
    if (typeof v === 'object') {
      try {
        const s = JSON.stringify(v);
        return s.length > 160 ? `${s.slice(0, 160)}…` : s;
      } catch {
        return '—';
      }
    }
    return String(v);
  }

  private static coerceNumericWeight(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const t = v.trim().replace(/%/g, '').replace(/\s/g, '').replace(',', '.');
      if (!t) return null;
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  private static readonly SECTOR_LABEL_ES: Readonly<Record<string, string>> = {
    energy: 'Energía',
    utilities: 'Servicios públicos',
    healthcare: 'Salud',
    realestate: 'Inmobiliario',
    real_estate: 'Inmobiliario',
    technology: 'Tecnología',
    industrials: 'Industrial',
    basic_materials: 'Materias primas',
    consumer_cyclical: 'Consumo cíclico',
    consumer_defensive: 'Consumo defensivo',
    financial_services: 'Financiero',
    communication_services: 'Comunicación',
  };

  private static sectorLabelEs(key: string): string {
    const id = key.toLowerCase().replace(/\s+/g, '_');
    return InversionComponent.SECTOR_LABEL_ES[id] ?? key.replace(/_/g, ' ');
  }

  /** Fracción típica Yahoo (0,12 = 12 %) → valor en escala porcentaje. */
  private static normalizeYahooFractionToPercent(n: number): number {
    if (!Number.isFinite(n) || n === 0) return n;
    if (Math.abs(n) <= 1) return n * 100;
    return n;
  }

  private static fundInfoKeyIsPercent(key: string): boolean {
    const k = key.toLowerCase();
    if (/morning|starrating|riskrating|symbol|name|isin|exchange|currency|timezone|family|category|legal|quotetype|close|open|high|low|volume|cap|mkt|price|assets|date|inception/i.test(k)) {
      return false;
    }
    return /return|yield|ratio|turnover|change|week|expense|premium|discount/i.test(k);
  }

  private static fundTableColumnIsPercent(col: string): boolean {
    const k = col.toLowerCase();
    if (/(^|_)(name|symbol|isin|ticker|cusip|sedol|date|time|rank|pos|uri|url|id)(\b|_)/i.test(k)) return false;
    return /pct|percent|weight|ratio|share|holding|allocation|exposure|return|yield|ytd|change|turnover|expense|stake|portion|contrib|growth|nav|premium|discount|momentum|volatility|beta|alpha|drawdown/i.test(
      k,
    );
  }

  private static fundTableColumnSignedReturn(col: string): boolean {
    return /return|change|ytd|gain|loss|drawdown|alpha|momentum/i.test(col.toLowerCase());
  }

  private static formatPercentFromYahooNumber(locale: string, columnKey: string, n: number): string {
    const pct = InversionComponent.normalizeYahooFractionToPercent(n);
    const s = formatNumber(pct, locale, '1.2-2');
    const signed = InversionComponent.fundTableColumnSignedReturn(columnKey);
    if (signed && pct > 0) return `+${s}%`;
    return `${s}%`;
  }

  private static formatFundNumericCell(locale: string, columnKey: string, n: number): string {
    if (InversionComponent.fundTableColumnIsPercent(columnKey)) {
      return InversionComponent.formatPercentFromYahooNumber(locale, columnKey, n);
    }
    return formatNumber(n, locale, '1.2-2');
  }

  /** Umbral mínimo de % para mostrar un sector (Yahoo rellena el resto con 0). */
  private static readonly FUND_SECTOR_MIN_DISPLAY_PCT = 0.005;

  private static parseFundDetailHttpError(err: { error?: { detail?: string | string[] } }): string {
    const d = err?.error?.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) return d.map(String).join('; ');
    return 'No se pudo cargar la ficha.';
  }

  private static objectKeyValueRows(obj: unknown): { key: string; value: unknown }[] {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
    return Object.entries(obj as Record<string, unknown>).map(([key, value]) => ({ key, value }));
  }

  private static resolveTopHoldingsColumnKeys(keys: string[]): { nameKey: string; pctKey: string | null } {
    const nameKey =
      keys.find((k) => /^name$/i.test(k.trim())) ??
      keys.find((k) => /^(holding|security|issuer)\s*name$/i.test(k)) ??
      keys.find((k) => k.toLowerCase() === 'nombre') ??
      keys.find((k) => /name/i.test(k) && !/(percent|pct|weight|ratio|symbol|code|isin)$/i.test(k)) ??
      keys[0];
    const pctKey =
      keys.find((k) => /^holding percent$/i.test(k.trim())) ??
      keys.find((k) => /holding.*percent|percent.*holding/i.test(k)) ??
      keys.find((k) => /^(pct|weight)$/i.test(k)) ??
      keys.find((k) => /percent|pct|weight|ratio/i.test(k) && !/name|symbol|exchange|code|isin/i.test(k)) ??
      null;
    return { nameKey, pctKey };
  }

  private static buildSectorBars(composition: Record<string, unknown>, locale: string): FundDetailSectorBar[] {
    const parsed: { key: string; pct: number }[] = [];
    const minPct = InversionComponent.FUND_SECTOR_MIN_DISPLAY_PCT;
    for (const { key, value } of InversionComponent.objectKeyValueRows(composition['sector_weightings'])) {
      const n = InversionComponent.coerceNumericWeight(value);
      if (n == null) continue;
      const pct = InversionComponent.normalizeYahooFractionToPercent(n);
      if (!Number.isFinite(pct) || pct < minPct) continue;
      parsed.push({ key, pct });
    }
    if (parsed.length === 0) return [];
    const max = Math.max(...parsed.map((p) => p.pct), 1e-9);
    return parsed
      .sort((a, b) => b.pct - a.pct)
      .map((p) => ({
        key: p.key,
        label: InversionComponent.sectorLabelEs(p.key),
        barFill: (p.pct / max) * 100,
        pctLabel: `${formatNumber(p.pct, locale, '1.2-2')}%`,
      }));
  }
}
