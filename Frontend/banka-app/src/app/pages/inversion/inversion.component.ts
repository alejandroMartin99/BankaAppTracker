import { formatDate, formatNumber } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnInit,
  ViewChild,
  inject,
  LOCALE_ID,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import {
  BenchmarkClasificacion,
  BenchmarkItem,
  BenchmarkPeriod,
  BenchmarkPoint,
  BenchmarksResponse,
  FundDetailPayload,
  FundDetailResponse,
  InvestmentFundsResponse,
  InvestmentService,
} from '../../services/investment.service';
import { BackendLoaderService } from '../../services/backend-loader.service';
import { sliceBenchmarksForPeriod } from '../../utils/investment-benchmark-slice';

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

const CHART_COLOR_OVERRIDES_BY_KEY = new Map<string, string>([
  ['FR0000989626', '#38bdf8'],
]);

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
  key: UiClasificacion;
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
  category: UiClasificacion;
  visible: boolean;
}

type UiClasificacion = BenchmarkClasificacion | 'sectores_especificos';

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

/** Una caja de leyenda por fondo + línea recta hasta la bolita en el corte. */
interface CrosshairLegendCallout {
  seriesKey: string;
  pctLabel: string;
  /** Color del texto entre paréntesis: verde si el rendimiento es no negativo, rojo si es negativo. */
  pctToneFill: string;
  color: string;
  /** Y de la serie en el gráfico (bolita). */
  pointY: number;
  /** Centro vertical de la caja y del texto. */
  centerY: number;
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
  /** X del ancla del texto (borde interno de la caja). */
  textX: number;
  /** Línea recta desde el borde de la caja (lado de la bolita) hasta la bolita. */
  leaderD: string;
  /** Nombre (línea 1 o única antes del paréntesis). */
  nameLine1: string;
  /** Continuación del nombre; null si todo el nombre cabe en la primera línea lógica. */
  nameLine2: string | null;
  /** `nombre (pct)` en una sola fila dentro de la caja. */
  singleRow: boolean;
  /** Ancho interior de la etiqueta usado al posicionar (evita recortar al encajar en el plot). */
  innerContentW: number;
}

/** Conjunto de callouts alineados a la misma columna X (sin panel único). */
interface CrosshairLegendPanel {
  rows: CrosshairLegendCallout[];
  placeRight: boolean;
}

@Component({
  selector: 'app-inversion',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inversion.component.html',
  styleUrl: './inversion.component.scss',
})
export class InversionComponent implements OnInit {
  private readonly investment = inject(InvestmentService);
  private readonly locale = inject(LOCALE_ID);
  private readonly hostRef = inject(ElementRef<HTMLElement>);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly backendLoader = inject(BackendLoaderService);

  @ViewChild('chartSvg', { read: ElementRef }) chartSvgRef?: ElementRef<SVGSVGElement>;

  /** Altura del viewBox: ratio vertical con el ancho (debe coincidir con `aspect-ratio` de `.chart-svg` en SCSS). */
  private static readonly CHART_ASPECT_H = 11;
  /** `font-size` de la leyenda del crosshair en unidades SVG; alinear con `.chart-svg .chart-tip-panel-row` en SCSS. */
  private static readonly CHART_CALLOUT_FONT_PX = 2.28;
  /**
   * Tope de caracteres (aprox.) para intentar nombre + % en una sola fila antes de partir en dos.
   * El bucle baja `chars` si no cabe en `avail`; este máximo evita partir demasiado pronto en pantallas anchas.
   */
  private static readonly CHART_CALLOUT_MAX_CHARS_SINGLE_LINE = 104;
  /** Tope del ancho estimado del tooltip (coords. SVG) al decidir izquierda/derecha del crosshair. */
  private static readonly CHART_CALLOUT_PROBE_MAX_WIDTH = 128;
  private static readonly CHART_VB_H = (100 * InversionComponent.CHART_ASPECT_H) / 16;
  readonly chartViewBox = `0 0 100 ${InversionComponent.CHART_VB_H}`;
  /** Escala Y respecto al layout histórico 0–100 (tipografía/márgenes bajo el trazado). */
  readonly chartSvgYScale = InversionComponent.CHART_VB_H / 100;

  readonly chartPadL = 10.25;
  /** Margen derecho del trazado (eje X / etiquetas). */
  readonly chartPadR = 1.25;
  /** Mínimo arriba del área de curvas (evita recorte del trazo). */
  readonly chartPadT = 0;
  /** Reserva bajo el trazado para fechas en eje X y etiqueta del crosshair (~≥9 en coords. 0–100). */
  readonly chartPadB = 9;

  period: BenchmarkPeriod = 'ytd';
  periodPresets: { id: BenchmarkPeriod; label: string }[] = [
    { id: 'ytd', label: 'YTD' },
    { id: '1m', label: '1M' },
    { id: '6m', label: '6M' },
    { id: '1y', label: '1Y' },
    { id: '3y', label: '3Y' },
    { id: '5y', label: '5Y' },
  ];

  loading = false;
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
  /** Leyenda del crosshair; se actualiza en cada movimiento (no depender solo del getter con event coalescing). */
  crosshairLegendPanel: CrosshairLegendPanel | null = null;
  private crosshairDragging = false;

  /** Series ocultas en el gráfico (solo vista; los datos siguen en memoria). */
  hiddenSeriesKeys: string[] = [];

  /** Payload completo del backend (horizonte ~5y + nav_bars); el periodo del gráfico se aplica en memoria. */
  private benchmarksRaw: BenchmarksResponse | null = null;

  /** Color estable por serie para la respuesta actual. */
  private seriesColorByKey = new Map<string, string>();

  /** Categorías con chip en el gráfico (solo se listan las que tengan series). */
  readonly chartCategoryDefs: { key: UiClasificacion; label: string }[] = [
    { key: 'fondos_monetarios', label: 'Monetarios' },
    { key: 'renta_fija', label: 'Renta fija' },
    { key: 'renta_variable', label: 'Renta variable' },
    { key: 'sectores_especificos', label: 'Sectores específicos' },
    { key: 'criptoactivos', label: 'Cripto' },
  ];

  /** Clasificación de filas de fondo (no incluye cripto; el cripto va siempre al grupo criptoactivos). */
  private readonly fundClasificacionKeys = new Set<string>([
    'sectores_especificos',
    'fondos_monetarios',
    'renta_fija',
    'renta_variable',
  ]);

  /** Orden en detalle: monetarios → RF → RV → cripto */
  readonly detailSectionOrder: { key: UiClasificacion; label: string }[] = [
    { key: 'fondos_monetarios', label: 'Fondos monetarios' },
    { key: 'renta_fija', label: 'Renta fija' },
    { key: 'renta_variable', label: 'Renta variable' },
    { key: 'sectores_especificos', label: 'Sectores específicos' },
    { key: 'criptoactivos', label: 'Criptoactivos' },
  ];
  detailGroups: DetailGroup[] = [];

  watchlistRows: { isin: string; sort_order?: number; created_at?: string }[] = [];
  /** ISIN del catálogo por defecto (autor); no se muestran como chips ni se deben volver a guardar. */
  private defaultAuthorIsinSet = new Set<string>();
  usingDefaultWatchlist = true;
  maxFunds = 40;
  newIsin = '';
  fundError: string | null = null;
  fundSubmitting = false;

  /** Modal ficha ampliada (API + caché servidor). */
  fundDetailOpen = false;
  fundDetailTitle = '';
  /** ISIN con el que se abrió la ficha (fondos); no es el ticker Yahoo. */
  fundDetailIsin: string | null = null;
  /** Par Yahoo con el que se abrió la ficha (cripto). */
  fundDetailCryptoSymbol: string | null = null;
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

  get chartCategoriesInData(): { key: UiClasificacion; label: string }[] {
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

  private computeCrosshairLegendPanel(): CrosshairLegendPanel | null {
    const p = this.chartPlot;
    if (!p || this.crosshairIndex == null) return null;
    const idx = this.crosshairIndex;
    const xLine = this.crosshairX;
    type Draft = {
      seriesKey: string;
      name: string;
      pctLabel: string;
      pctValue: number;
      pctToneFill: string;
      color: string;
      pointY: number;
    };
    const draft: Draft[] = [];
    for (const s of p.series) {
      const v = s.values[idx];
      if (v == null) continue;
      draft.push({
        seriesKey: s.seriesKey,
        name: (s.name || '').trim(),
        pctLabel: InversionComponent.formatTipPct(v),
        pctValue: v,
        pctToneFill: InversionComponent.crosshairPctToneFill(v),
        color: s.color,
        pointY: this.chartYAt(p, v),
      });
    }
    if (draft.length === 0) return null;
    draft.sort((a, b) => a.pointY - b.pointY);

    const sy = this.chartSvgYScale;
    const fz = InversionComponent.CHART_CALLOUT_FONT_PX;
    /** Ancho medio por carácter en coords. SVG (sans proporcional; mayúsculas / tabular-nums). */
    const charUnit = 1.1 * (fz / 3.05);
    const padX = 1.68;
    const padYTight = 0.28 * sy;
    const plotMargin = 0.35;
    const dotR = 0.48;
    /** Hueco horizontal entre el borde de la bolita y el borde interior de la caja. */
    const hGapAfterDot = 1.35;

    let estProbeW = 30;
    for (const d of draft) {
      const paren = `(${d.pctLabel})`;
      const wLine = (d.name + ' ' + paren).length * charUnit + 2.6;
      estProbeW = Math.max(estProbeW, wLine);
    }
    estProbeW = Math.min(estProbeW, InversionComponent.CHART_CALLOUT_PROBE_MAX_WIDTH);

    const laneRightMin = xLine + dotR + hGapAfterDot;
    const laneLeftMax = xLine - dotR - hGapAfterDot;
    const spaceRight = p.plotRight - laneRightMin - plotMargin;
    const spaceLeft = laneLeftMax - p.plotLeft - plotMargin;
    let placeRight = spaceRight >= spaceLeft;
    const probeBoxW = estProbeW + padX * 2;
    if (spaceRight < probeBoxW && spaceLeft >= probeBoxW) placeRight = false;
    else if (spaceLeft < probeBoxW && spaceRight >= probeBoxW) placeRight = true;

    const avail = placeRight ? p.plotRight - laneRightMin - plotMargin : laneLeftMax - p.plotLeft - plotMargin;
    const charsAvail = Math.max(
      16,
      Math.min(
        InversionComponent.CHART_CALLOUT_MAX_CHARS_SINGLE_LINE,
        Math.floor((Math.max(28, avail) - 0.35) / charUnit),
      ),
    );

    const rows: CrosshairLegendCallout[] = [];
    for (let i = 0; i < draft.length; i++) {
      const d = draft[i];
      let chars = charsAvail;
      let lab = InversionComponent.buildCrosshairFundLabel(d.name, d.pctLabel, chars);
      let tight = InversionComponent.crosshairLabelContentWidth(lab, d.pctLabel, charUnit);
      while (tight > avail - 0.02 && chars > 16) {
        chars -= 1;
        lab = InversionComponent.buildCrosshairFundLabel(d.name, d.pctLabel, chars);
        tight = InversionComponent.crosshairLabelContentWidth(lab, d.pctLabel, charUnit);
      }
      /** Respiro horizontal + sidebearings; la caja debe sobrar respecto al texto medido. */
      const hBreath = 0.92 * fz + 2.55;
      const naturalInner = tight + hBreath;
      const contentW = Math.min(naturalInner, Math.max(14, avail));
      const boxW = contentW + padX * 2;
      const twoName = !lab.singleRow;
      /** Alto del bloque de texto (em) + margen real para descenders y `stroke` del rect (el layout debe ≥ píxeles pintados). */
      const textBlockH = twoName ? (0.6 + 1.14 + 1.22) * fz : 1.42 * fz;
      const boxH = 2 * padYTight + textBlockH + 0.78;
      rows.push({
        seriesKey: d.seriesKey,
        pctLabel: d.pctLabel,
        pctToneFill: d.pctToneFill,
        color: d.color,
        pointY: d.pointY,
        centerY: 0,
        boxX: 0,
        boxY: 0,
        boxW,
        boxH,
        textX: 0,
        leaderD: '',
        nameLine1: lab.nameLine1,
        nameLine2: lab.nameLine2,
        singleRow: lab.singleRow,
        innerContentW: contentW,
      });
    }

    /** Hueco mínimo entre rectángulos (centros separados con boxH real). */
    const slack = Math.max(6.4 * sy, 4.5 + 1.85 * (rows.length - 1));
    InversionComponent.assignCrosshairCalloutCenters(rows, p.plotTop, p.plotBottom, slack);

    const maxR = p.plotRight - plotMargin;
    const minL = p.plotLeft + plotMargin;
    for (const r of rows) {
      let bw = r.innerContentW + padX * 2;
      r.boxW = bw;
      r.boxX = placeRight ? laneRightMin : laneLeftMax - bw;
      if (placeRight && r.boxX + r.boxW > maxR) {
        const shiftedX = maxR - r.boxW;
        if (shiftedX >= laneRightMin - 0.02) {
          r.boxX = shiftedX;
        } else {
          r.boxX = laneRightMin;
          r.boxW = Math.max(padX * 2 + 14 * charUnit, maxR - r.boxX);
        }
      }
      if (!placeRight) {
        if (r.boxX < minL) {
          const shiftedX = minL;
          if (shiftedX + r.boxW <= laneLeftMax + 0.02) {
            r.boxX = shiftedX;
          } else {
            r.boxX = Math.max(minL, laneLeftMax - r.boxW);
          }
        }
        if (r.boxX + r.boxW > laneLeftMax) {
          r.boxW = Math.max(padX * 2 + 14 * charUnit, laneLeftMax - r.boxX);
          r.boxX = laneLeftMax - r.boxW;
        }
      }
      r.boxY = r.centerY - r.boxH / 2;
      r.textX = placeRight ? r.boxX + padX : r.boxX + r.boxW - padX;
      const ax = placeRight ? r.boxX : r.boxX + r.boxW;
      r.leaderD = `M ${xLine} ${r.pointY} L ${ax} ${r.centerY}`;
    }

    return { rows, placeRight };
  }

  private syncCrosshairLegendPanel(): void {
    this.crosshairLegendPanel = this.computeCrosshairLegendPanel();
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
    this.crosshairLegendPanel = null;
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
    this.syncCrosshairLegendPanel();
    this.cdr.detectChanges();
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

  private static readonly YAHOO_INTERNAL_TICKER_RE = /^0P[0-9A-Z]{6,}\.[A-Z0-9]+$/i;

  /** Misma lista reducida que ISIN_FALLBACK_LABEL en backend (nombre comercial vs fundFamily = gestora). */
  private static readonly FUND_DETAIL_TITLE_ISIN_FALLBACK: Readonly<Record<string, string>> = {
    ES0165243025: 'Myinvestor Value FI',
  };

  /** Evita usar códigos internos tipo 0P0001T8V7.F como título del modal. */
  private static pickNonInternalFundTitle(
    idKeyUpper: string,
    raw?: string | null,
  ): string | null {
    const s = (raw || '').trim();
    if (!s || s.toUpperCase() === idKeyUpper) return null;
    if (InversionComponent.YAHOO_INTERNAL_TICKER_RE.test(s)) return null;
    return s;
  }

  /** Título de ficha: prioriza nombres legibles; alinea criterios con el backend. */
  private static resolveFundDetailTitle(
    idKeyUpper: string,
    detail: FundDetailPayload | null | undefined,
    fallback: string,
  ): string {
    if (!detail) return fallback;

    const infRaw = detail.info;
    const infOk =
      infRaw && typeof infRaw === 'object' && !Array.isArray(infRaw)
        ? (infRaw as Record<string, unknown>)
        : null;

    const gi = (k: string): string | undefined => {
      if (!infOk) return undefined;
      const v = infOk[k];
      return typeof v === 'string' ? v.trim() : undefined;
    };

    if (infOk) {
      for (const k of ['longName', 'displayName', 'name', 'shortName']) {
        const hit = InversionComponent.pickNonInternalFundTitle(idKeyUpper, gi(k));
        if (hit) return hit;
      }
    }

    const curated = InversionComponent.FUND_DETAIL_TITLE_ISIN_FALLBACK[idKeyUpper];
    if (curated) return curated;

    const descInf = gi('description');
    if (descInf) {
      const first = descInf.split('. ')[0].trim();
      const hit = InversionComponent.pickNonInternalFundTitle(idKeyUpper, first);
      if (hit && first.length > 12) return hit;
    }

    const comp = detail.composition;
    if (comp && typeof comp === 'object' && !Array.isArray(comp)) {
      const fo = comp['fund_overview'];
      if (fo && typeof fo === 'object' && !Array.isArray(fo)) {
        const o = fo as Record<string, unknown>;
        for (const key of ['Fund Name', 'Name', 'Legal Name', 'longName']) {
          const v = o[key];
          if (typeof v === 'string') {
            const hit = InversionComponent.pickNonInternalFundTitle(idKeyUpper, v);
            if (hit) return hit;
          }
        }
      }
      const desc = comp['description'];
      if (typeof desc === 'string' && desc.trim()) {
        const first = desc.trim().split('. ')[0].trim();
        const hit = InversionComponent.pickNonInternalFundTitle(idKeyUpper, first);
        if (hit && first.length > 12) return hit;
      }
    }

    const ff = gi('fundFamily');
    const cat = gi('category');
    if (ff && cat && ff.toLowerCase() !== cat.toLowerCase()) {
      const combo = `${ff} (${cat})`;
      const hit = InversionComponent.pickNonInternalFundTitle(idKeyUpper, combo);
      if (hit) return hit;
    }
    if (ff) {
      const hit = InversionComponent.pickNonInternalFundTitle(idKeyUpper, ff);
      if (hit) return hit;
    }

    return fallback;
  }

  private static formatTipPct(v: number): string {
    const x = Math.round(v * 100) / 100;
    if (Math.abs(x) < 1e-9) return '0%';
    if (x < 0) return `${x}%`;
    return `+${x}%`;
  }

  private static crosshairPctToneFill(v: number): string {
    return v >= 0 ? '#15803d' : '#b91c1c';
  }

  /**
   * Nombre en negro + `(pct)` aparte; una fila si cabe, si no nombre en dos líneas y `(pct)` al final de la segunda.
   */
  private static buildCrosshairFundLabel(
    name: string,
    pctLabel: string,
    charsPerLine: number,
  ): { nameLine1: string; nameLine2: string | null; singleRow: boolean } {
    const nm = (name || '').trim();
    const paren = `(${pctLabel})`;
    const combined = `${nm} ${paren}`;
    if (combined.length <= charsPerLine) {
      return { nameLine1: nm, nameLine2: null, singleRow: true };
    }
    const room2 = Math.max(8, charsPerLine - paren.length - 1);
    const room1 = Math.max(8, charsPerLine);
    const sp = InversionComponent.splitCrosshairNameLines(nm, room1, room2);
    if (sp.line2 != null && sp.line2.length > 0) {
      return { nameLine1: sp.line1, nameLine2: sp.line2, singleRow: false };
    }
    const cut = Math.max(1, room1 - 1);
    const line1 = nm.slice(0, cut).trimEnd();
    const line2 = nm.slice(cut).trimStart();
    if (!line2) return { nameLine1: nm, nameLine2: null, singleRow: true };
    return { nameLine1: line1, nameLine2: line2, singleRow: false };
  }

  /** Ancho de contenido (sin padding de caja) según el reparto de líneas ya calculado. */
  private static crosshairLabelContentWidth(
    lab: { nameLine1: string; nameLine2: string | null; singleRow: boolean },
    pctLabel: string,
    charUnit: number,
  ): number {
    const paren = `(${pctLabel})`;
    /** Cola anti-recorte (kerning, glifos anchos, tabular-nums, redondeo del motor de texto). */
    const tail = 6.45 + 0.07 * Math.max(12, paren.length + lab.nameLine1.length + (lab.nameLine2?.length ?? 0));
    if (lab.singleRow) {
      return (lab.nameLine1.length + 1 + paren.length) * charUnit + tail;
    }
    const w1 = lab.nameLine1.length * charUnit;
    const w2 = ((lab.nameLine2 || '') + ' ' + paren).length * charUnit;
    return Math.max(w1, w2) + tail;
  }

  /**
   * Parte el nombre en dos líneas por espacio (sin truncar salvo imposible caber).
   */
  private static splitCrosshairNameLines(
    rawName: string,
    maxCharsLine1: number,
    maxCharsLine2: number,
  ): { line1: string; line2: string | null } {
    const s = (rawName || '').trim();
    if (!s) return { line1: '', line2: null };
    if (s.length <= maxCharsLine1) return { line1: s, line2: null };
    let cut = maxCharsLine1;
    const win = s.slice(0, Math.min(s.length, maxCharsLine1 + 24));
    const sp = win.lastIndexOf(' ');
    if (sp >= Math.floor(maxCharsLine1 * 0.38)) cut = sp;
    const part1 = s.slice(0, cut).trimEnd();
    const part2 = s.slice(cut).trimStart();
    if (!part2) return { line1: part1 || s, line2: null };
    if (part2.length <= maxCharsLine2) return { line1: part1, line2: part2 };
    const w = part2.slice(0, maxCharsLine2 + 20);
    const sp2 = w.lastIndexOf(' ');
    let cut2 = maxCharsLine2;
    if (sp2 > Math.floor(maxCharsLine2 * 0.38)) cut2 = sp2;
    const p2a = part2.slice(0, cut2).trimEnd();
    const p2b = part2.slice(cut2).trimStart();
    if (p2b.length === 0) return { line1: part1, line2: p2a };
    return { line1: part1, line2: `${p2a} ${p2b}`.trim() };
  }

  /**
   * Centros Y del texto: misma orden que pointY; separación según altura de cada caja + slack.
   */
  private static assignCrosshairCalloutCenters(
    rows: CrosshairLegendCallout[],
    plotTop: number,
    plotBottom: number,
    slack: number,
  ): void {
    const n = rows.length;
    if (n === 0) return;
    const margin = 0.35;
    const half0 = rows[0].boxH / 2;
    const topB = plotTop + half0 + margin;
    const halfLast = rows[n - 1].boxH / 2;
    const botB = plotBottom - halfLast - margin;
    if (n === 1) {
      rows[0].centerY = Math.min(botB, Math.max(topB, rows[0].pointY));
      return;
    }
    let ly = rows.map((r) => r.pointY);
    for (let pass = 0; pass < n + 14; pass++) {
      for (let i = 1; i < n; i++) {
        const need = ly[i - 1] + rows[i - 1].boxH / 2 + rows[i].boxH / 2 + slack;
        if (ly[i] < need) ly[i] = need;
      }
      for (let i = n - 2; i >= 0; i--) {
        const need = ly[i + 1] - rows[i + 1].boxH / 2 - rows[i].boxH / 2 - slack;
        if (ly[i] > need) ly[i] = need;
      }
    }
    if (ly[0] - rows[0].boxH / 2 < plotTop + margin) {
      const d = plotTop + margin + rows[0].boxH / 2 - ly[0];
      ly = ly.map((y) => y + d);
    }
    if (ly[n - 1] + rows[n - 1].boxH / 2 > plotBottom - margin) {
      const d = plotBottom - margin - rows[n - 1].boxH / 2 - ly[n - 1];
      ly = ly.map((y) => y + d);
    }
    if (ly[0] - rows[0].boxH / 2 < plotTop + margin || ly[n - 1] + rows[n - 1].boxH / 2 > plotBottom - margin) {
      const span = Math.max(0, botB - topB);
      const midSum = rows.slice(1, -1).reduce((s, r) => s + r.boxH, 0);
      /** Distancia mínima centro[i]→centro[i+1] sin hueco extra (solo mitades de caja). */
      const T = rows[0].boxH / 2 + rows[n - 1].boxH / 2 + midSum;
      if (span < T - 1e-6) {
        const step = span / Math.max(1, n - 1);
        ly = rows.map((_, k) => topB + k * step);
      } else {
        /** Hueco efectivo entre cajas: el pedido `slack` o lo que quepa en el alto del plot. */
        const effSlack = Math.min(slack, (span - T) / Math.max(1, n - 1));
        const chain = T + (n - 1) * effSlack;
        let y0 = topB + Math.max(0, (span - chain) / 2);
        ly = [y0];
        for (let j = 1; j < n; j++) {
          y0 += rows[j - 1].boxH / 2 + rows[j].boxH / 2 + effSlack;
          ly.push(y0);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      rows[i].centerY = ly[i];
    }
  }

  setPeriod(p: BenchmarkPeriod): void {
    if (this.period === p) return;
    this.period = p;
    if (this.benchmarksRaw) {
      this.reapplyPeriodSlice();
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

  categoryChipState(cat: UiClasificacion): 'all' | 'none' | 'partial' {
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

  toggleCategoryVisibility(cat: UiClasificacion): void {
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
    this.backendLoader.beginMinimalLoad();
    this.loading = true;
    this.error = null;
    this.fundError = null;
    this.errors = [];
    this.cryptoErrors = [];
    forkJoin({
      funds: this.investment.getFunds(),
      bench: this.investment.getBenchmarks(),
    }).subscribe({
      next: ({ funds, bench }) => {
        this.applyFundsResponse(funds);
        this.applyBenchmarkResponse(bench);
        this.loading = false;
        this.backendLoader.endMinimalLoad();
      },
      error: (err) => {
        this.loadAttempted = true;
        this.benchmarksRaw = null;
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
        this.backendLoader.endMinimalLoad();
      },
    });
  }

  loadBenchmarksOnly(): void {
    this.loading = true;
    this.error = null;
    this.errors = [];
    this.cryptoErrors = [];
    this.investment.getBenchmarks().subscribe({
      next: (res) => {
        this.applyBenchmarkResponse(res);
        this.loading = false;
      },
      error: (err) => {
        this.benchmarksRaw = null;
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
      },
    });
  }

  submitNewFund(): void {
    if (this.fundSubmitting) return;
    this.fundError = null;
    const raw = this.newIsin.trim().toUpperCase();
    if (raw.length !== 12) {
      this.fundError = 'El ISIN debe tener 12 caracteres.';
      return;
    }
    if (this.defaultAuthorIsinSet.has(raw)) {
      this.fundError = 'Este ISIN ya está en la selección por defecto; no hace falta añadirlo.';
      return;
    }
    this.fundSubmitting = true;
    this.investment.addFund(raw).subscribe({
      next: () => {
        this.newIsin = '';
        this.refreshFundsAndBenchmarks(() => {
          this.fundSubmitting = false;
        });
      },
      error: (err) => {
        this.fundError = err.error?.detail || 'No se pudo añadir el ISIN.';
        this.fundSubmitting = false;
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

  /** Chips «Mis fondos»: solo ISIN añadidos por el usuario que no están en el catálogo por defecto. */
  get watchlistUserOnlyRows(): { isin: string; sort_order?: number; created_at?: string }[] {
    return this.watchlistRows.filter((w) => {
      const k = (w.isin || '').trim().toUpperCase();
      return k.length === 12 && !this.defaultAuthorIsinSet.has(k);
    });
  }

  /** Guardados en BD pero redundantes con el catálogo por defecto (no se listan como chips). */
  get watchlistDefaultDuplicateRows(): { isin: string; sort_order?: number; created_at?: string }[] {
    return this.watchlistRows.filter((w) => {
      const k = (w.isin || '').trim().toUpperCase();
      return k.length === 12 && this.defaultAuthorIsinSet.has(k);
    });
  }

  /** Quita de Supabase los ISIN que coinciden con el catálogo por defecto (limpieza de duplicados). */
  purgeDefaultIsinsFromWatchlist(): void {
    const isins = this.watchlistDefaultDuplicateRows.map((r) => r.isin.trim().toUpperCase());
    if (!isins.length) return;
    this.fundError = null;
    forkJoin(isins.map((i) => this.investment.removeFund(i))).subscribe({
      next: () => this.refreshFundsAndBenchmarks(),
      error: (err) => {
        this.fundError = err.error?.detail || 'No se pudieron quitar todos los ISIN duplicados.';
      },
    });
  }

  private refreshFundsAndBenchmarks(onDone?: () => void): void {
    forkJoin({
      funds: this.investment.getFunds(),
      bench: this.investment.getBenchmarks(),
    }).subscribe({
      next: ({ funds, bench }) => {
        this.applyFundsResponse(funds);
        this.applyBenchmarkResponse(bench);
        onDone?.();
      },
      error: (err) => {
        this.fundError = err.error?.detail || 'Error al actualizar la lista.';
        this.loading = false;
        onDone?.();
      },
    });
  }

  private applyFundsResponse(f: InvestmentFundsResponse): void {
    this.watchlistRows = Array.isArray(f.items) ? f.items : [];
    this.maxFunds = typeof f.max_funds === 'number' ? f.max_funds : 40;
    const defs = Array.isArray(f.default_isins) ? f.default_isins : [];
    this.defaultAuthorIsinSet = new Set(defs.map((x) => String(x).trim().toUpperCase()).filter((x) => x.length === 12));
  }

  private applyBenchmarkResponse(res: BenchmarksResponse): void {
    this.loadAttempted = true;
    this.benchmarksRaw = res;
    const itemIsins = new Set(
      [...(res.items ?? []), ...(res.crypto_items ?? [])]
        .map((it) => (it.isin || '').trim().toUpperCase())
        .filter((x) => x.length === 12),
    );
    this.errors = (Array.isArray(res.errors) ? res.errors : []).filter(
      (e) => !itemIsins.has((e.isin || '').trim().toUpperCase()),
    );
    this.cryptoErrors = Array.isArray(res.crypto_errors) ? res.crypto_errors : [];
    this.usingDefaultWatchlist = res.using_default_watchlist ?? true;
    this.reapplyPeriodSlice();
    this.resolveMissingFundDisplayNames();
  }

  private isFundNameUnresolved(row: BenchmarkItem): boolean {
    const isin = (row.isin || '').trim().toUpperCase();
    if (!isin || isin.length !== 12) return false;
    const name = (row.name || '').trim();
    if (!name || name.toUpperCase() === isin) return true;
    return InversionComponent.YAHOO_INTERNAL_TICKER_RE.test(name);
  }

  private patchFundDisplayName(isin: string, name: string): void {
    const key = isin.trim().toUpperCase();
    const cleaned = InversionComponent.pickNonInternalFundTitle(key, name.trim());
    if (!cleaned || cleaned.toUpperCase() === key) return;
    const apply = (row: BenchmarkItem) => {
      if ((row.isin || '').trim().toUpperCase() === key) row.name = cleaned;
    };
    this.items.forEach(apply);
    this.benchmarksRaw?.items?.forEach(apply);
    this.rebuildDetailGroups();
    this.rebuildChart();
    this.cdr.markForCheck();
  }

  /** ISIN añadidos por el usuario: resuelve nombre desde ficha en caché si el benchmark solo trae el código. */
  private resolveMissingFundDisplayNames(): void {
    const pending = this.items.filter((it) => this.isFundNameUnresolved(it));
    if (!pending.length) return;
    forkJoin(
      pending.map((it) =>
        this.investment.getFundDetail(it.isin).pipe(catchError(() => of(null as FundDetailResponse | null))),
      ),
    ).subscribe((responses) => {
      pending.forEach((it, i) => {
        const r = responses[i];
        if (!r?.success || !r.detail) return;
        const idKey = it.isin.trim().toUpperCase();
        const title = InversionComponent.resolveFundDetailTitle(idKey, r.detail, it.name);
        this.patchFundDisplayName(idKey, title);
      });
    });
  }

  private reapplyPeriodSlice(): void {
    if (!this.benchmarksRaw) {
      this.items = [];
      this.cryptoItems = [];
      this.pruneHiddenSeriesKeys();
      this.refreshSeriesColorMap();
      this.rebuildChart();
      this.rebuildDetailGroups();
      return;
    }
    const sliced = sliceBenchmarksForPeriod(this.benchmarksRaw, this.period);
    this.items = sliced.items;
    this.cryptoItems = Array.isArray(sliced.crypto_items) ? sliced.crypto_items : [];
    this.pruneHiddenSeriesKeys();
    this.refreshSeriesColorMap();
    this.rebuildChart();
    this.rebuildDetailGroups();
  }

  private isSpecificSectorFund(row: BenchmarkItem): boolean {
    const name = (row.name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    // Clasificación temática automática por palabras clave de nicho/sector.
    const thematicKeywords = [
      'healthcare',
      'health care',
      'biotech',
      'biotechnology',
      'medical',
      'pharma',
      'defense',
      'defence',
      'uranium',
      'nuclear',
      'clean energy',
      'energy',
      'renewable',
      'robotics',
      'artificial intelligence',
      'ai ',
      'cybersecurity',
      'semiconductor',
      'nasdaq 100',
    ];
    return thematicKeywords.some((k) => name.includes(k));
  }

  private effectiveClasificacion(row: BenchmarkItem): UiClasificacion {
    if (this.isSpecificSectorFund(row)) return 'sectores_especificos';
    const raw = row.clasificacion;
    if (raw && this.fundClasificacionKeys.has(raw as string)) {
      return raw as UiClasificacion;
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

  private keysForCategory(cat: UiClasificacion): string[] {
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
        next.set(k, CHART_COLOR_OVERRIDES_BY_KEY.get(k) ?? CHART_COLORS[colorIdx % CHART_COLORS.length]);
        colorIdx++;
      }
    }
    this.seriesColorByKey = next;
  }

  private rebuildDetailGroups(): void {
    const buckets = new Map<UiClasificacion, BenchmarkItem[]>();
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
      this.crosshairLegendPanel = null;
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
      this.crosshairLegendPanel = null;
      return;
    }
    if (ymin === ymax) {
      ymin -= 2;
      ymax += 2;
    }
    const pad = (ymax - ymin) * 0.02;
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
    this.syncCrosshairLegendPanel();
  }

  openFundDetail(row: BenchmarkItem, grpKey: UiClasificacion): void {
    const isCrypto = grpKey === 'criptoactivos';
    const isin = !isCrypto && row.isin?.trim() ? row.isin.trim().toUpperCase() : undefined;
    const sym = isCrypto && row.symbol?.trim() ? row.symbol.trim() : undefined;
    if (!isin && !sym) return;
    this.fundDetailOpen = true;
    const idKey = (isin || sym || '').trim().toUpperCase();
    const initialRaw = (row.name || isin || sym || '').trim();
    const cleaned = InversionComponent.pickNonInternalFundTitle(idKey, initialRaw);
    this.fundDetailTitle = cleaned || idKey;
    this.fundDetailIsin = isin ?? null;
    this.fundDetailCryptoSymbol = sym ?? null;
    this.fundDetailLoading = true;
    this.fundDetailError = null;
    this.fundDetailResponse = null;
    this.investment.getFundDetail(isin, sym).subscribe({
      next: (r) => {
        this.fundDetailResponse = r;
        this.fundDetailLoading = false;
        const idKey = (isin || sym || '').trim().toUpperCase();
        this.fundDetailTitle = InversionComponent.resolveFundDetailTitle(
          idKey,
          r.detail,
          this.fundDetailTitle,
        );
        if (isin && this.fundDetailTitle) {
          this.patchFundDisplayName(idKey, this.fundDetailTitle);
        }
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
    this.fundDetailIsin = null;
    this.fundDetailCryptoSymbol = null;
  }

  /** Cierra «Tipo» / «Fondos» y la ayuda «i» del detalle al pulsar fuera. */
  @HostListener('document:click', ['$event'])
  onDocumentClickCloseChartFilters(ev: MouseEvent): void {
    const t = ev.target;
    if (!(t instanceof Node)) return;
    for (let n: Node | null = t; n; n = n.parentNode) {
      if (n instanceof HTMLDetailsElement && n.classList.contains('chart-dd')) {
        return;
      }
      if (n instanceof HTMLDetailsElement && n.classList.contains('detalle-info-help')) {
        return;
      }
    }
    this.closeOpenChartDdDetails();
    this.closeOpenDetalleInfoHelp();
  }

  private closeOpenChartDdDetails(): void {
    const nodes = this.hostRef.nativeElement.querySelectorAll('details.chart-dd[open]');
    nodes.forEach((node: Element) => {
      (node as HTMLDetailsElement).open = false;
    });
  }

  private closeOpenDetalleInfoHelp(): void {
    const node = this.hostRef.nativeElement.querySelector('details.detalle-info-help[open]');
    if (node instanceof HTMLDetailsElement) {
      node.open = false;
    }
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
  fundDetailEssentialInfoRows(): { key: string; label: string; value: unknown; hint?: string }[] {
    const info = this.fundDetailInfo();
    if (!info) return [];
    const out: { key: string; label: string; value: unknown; hint?: string }[] = [];
    for (const { key, label } of InversionComponent.FUND_DETAIL_ESSENTIAL_FIELDS) {
      const v = info[key];
      if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) continue;
      out.push({
        key,
        label,
        value: v,
        hint: InversionComponent.FUND_DETAIL_ESSENTIAL_HINTS[key],
      });
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
    { key: 'longName', label: 'Nombre' },
    { key: 'category', label: 'Categoría' },
    { key: 'fundFamily', label: 'Familia del fondo' },
    { key: 'currency', label: 'Divisa' },
    { key: 'legalType', label: 'Tipo legal' },
    { key: 'fullExchangeName', label: 'Mercado' },
    { key: 'totalAssets', label: 'Activos totales' },
    { key: 'yield', label: 'Yield' },
    { key: 'fiftyTwoWeekChangePercent', label: 'Variación 52 semanas' },
    { key: 'annualReportExpenseRatio', label: 'Ratio de gastos (TER)' },
    { key: 'fundInceptionDate', label: 'Fecha de lanzamiento' },
    { key: 'morningStarOverallRating', label: 'Morningstar (valoración)' },
    { key: 'morningStarRiskRating', label: 'Morningstar (riesgo)' },
  ];

  private static readonly FUND_DETAIL_ESSENTIAL_HINTS: Readonly<Record<string, string>> = {
    fiftyTwoWeekChangePercent: 'Variación aproximada del precio en 52 semanas según Yahoo.',
    annualReportExpenseRatio:
      'Si aparece 0%, suele ser dato no publicado en esta fuente, no necesariamente comisión cero.',
    yield: 'Distribución / rendimiento por cupón según Yahoo; a veces 0 si no hay dato.',
    totalAssets: 'Patrimonio bajo gestión (referencia); puede ir en divisa de cotización.',
  };

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

  /**
   * Yahoo envía `fundInceptionDate` como epoch (segundos o ms) o a veces ISO string.
   */
  private static formatFundInceptionForDisplay(locale: string, v: unknown): string | null {
    const fromSec = (sec: number): string | null => {
      if (!Number.isFinite(sec)) return null;
      if (sec < 315532800 || sec > 2524608000) return null;
      const d = new Date(sec * 1000);
      if (Number.isNaN(d.getTime())) return null;
      return formatDate(d, 'mediumDate', locale);
    };

    if (typeof v === 'number' && Number.isFinite(v)) {
      const n = v;
      if (n >= 315532800000 && n <= 2524608000000) return fromSec(Math.round(n / 1000));
      return fromSec(Math.round(n));
    }
    if (typeof v === 'string') {
      const t = v.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
        const d = new Date(t);
        if (!Number.isNaN(d.getTime())) return formatDate(d, 'mediumDate', locale);
      }
      if (/^\d{10,13}$/.test(t)) {
        const n = Number(t);
        if (n >= 315532800000) return fromSec(Math.round(n / 1000));
        return fromSec(Math.round(n));
      }
    }
    return null;
  }

  /** Campos del bloque `info` de Yahoo (clave camelCase). */
  formatFundInfoValue(infoKey: string, v: unknown): string {
    if (v == null) return '—';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (infoKey === 'fundInceptionDate') {
      const inc = InversionComponent.formatFundInceptionForDisplay(this.locale, v);
      if (inc != null) return inc;
    }
    if (typeof v === 'string') {
      const t0 = v.trim();
      if (InversionComponent.fundInfoKeyIsPercent(infoKey)) {
        const normalized = t0.replace(/\s/g, '').replace('%', '').replace(',', '.');
        if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(normalized)) {
          const n = Number(normalized);
          if (Number.isFinite(n)) {
            return InversionComponent.formatPercentFromYahooNumber(this.locale, infoKey, n);
          }
        }
      }
      return t0.length > 200 ? `${t0.slice(0, 200)}…` : t0;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      const k = infoKey.toLowerCase();
      if (/morning|starrating|riskrating/.test(k)) {
        return formatNumber(v, this.locale, '1.0-0');
      }
      if (infoKey === 'totalAssets') {
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
