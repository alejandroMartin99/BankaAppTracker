import type {
  BenchmarkItem,
  BenchmarkPeriod,
  BenchmarkPoint,
  BenchmarksResponse,
} from '../services/investment.service';

/** `close` = precio o NAV absoluto; el % vs inicio de ventana no tiene techo fijo (p. ej. +350% en años). */
export type NavBar = { date: string; close: number };

const NAV_BAR_MIN_STEP_RATIO = 0.008;
const NAV_BAR_MAX_STEP_RATIO = 30;

const INTERVAL_BY_PERIOD: Record<BenchmarkPeriod, string> = {
  ytd: '1d',
  '1m': '1d',
  '3m': '1d',
  '6m': '1d',
  '1y': '1mo',
  '3y': '1mo',
  '5y': '1d',
};

/** YYYY-MM-DD en calendario local (no UTC): alinear con fechas de `nav_bars` del backend. */
function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function periodStartIso(period: BenchmarkPeriod, now: Date): string | null {
  const dayMs = 86400000;
  if (period === 'ytd') {
    return `${now.getFullYear()}-01-01`;
  }
  if (period === '1m') {
    return ymdLocal(new Date(now.getTime() - 32 * dayMs));
  }
  if (period === '3m') {
    return ymdLocal(new Date(now.getTime() - 92 * dayMs));
  }
  if (period === '6m') {
    return ymdLocal(new Date(now.getTime() - 183 * dayMs));
  }
  if (period === '1y') {
    return ymdLocal(new Date(now.getTime() - 365 * dayMs));
  }
  if (period === '3y') {
    return ymdLocal(new Date(now.getTime() - 365 * 3 * dayMs));
  }
  if (period === '5y') {
    return ymdLocal(new Date(now.getTime() - 365 * 5 * dayMs));
  }
  return null;
}

function sliceNavBars(bars: NavBar[], startIso: string | null): NavBar[] {
  if (!startIso) return [...bars];
  return bars.filter((b) => (b.date || '') >= startIso);
}

/** Fechas ISO YYYY-MM-DD; sin esto el «primer» cierre puede ser el último año y el % vs inicio se ve invertido. */
function sortNavBarsByDateAsc(bars: NavBar[]): NavBar[] {
  return [...bars].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

/** Solo barra a barra (datos corruptos); no limita el % acumulado respecto al primer cierre. */
function sanitizeNavBars(bars: NavBar[]): NavBar[] {
  if (!bars?.length || bars.length < 2) {
    return bars?.length ? [...bars] : [];
  }
  const out: NavBar[] = [{ ...bars[0] }];
  let prev = out[0].close;
  for (let i = 1; i < bars.length; i++) {
    const raw = bars[i].close;
    let use = raw;
    if (prev > 0) {
      const ratio = raw / prev;
      if (ratio < NAV_BAR_MIN_STEP_RATIO || ratio > NAV_BAR_MAX_STEP_RATIO) {
        use = prev;
      }
    }
    if (use > 0) {
      prev = use;
    }
    out.push({ date: bars[i].date, close: Math.round(use * 1e6) / 1e6 });
  }
  return out;
}

/** Rentabilidad acumulada vs el primer cierre de la serie ya recortada al periodo (sin techo ±100). */
function pctPointsFromNavBars(bars: NavBar[]): BenchmarkPoint[] {
  const cleaned = sanitizeNavBars(bars);
  const first = cleaned.find((b) => typeof b.close === 'number' && b.close > 0)?.close;
  if (first == null || first <= 0) return [];
  return cleaned.map((b) => ({
    date: b.date,
    pct_vs_start: Math.round((b.close / first - 1) * 10000) / 100,
  }));
}

function materializeItemForPeriod(row: BenchmarkItem, period: BenchmarkPeriod): BenchmarkItem {
  const bars = row.nav_bars;
  if (!bars?.length) {
    return {
      ...row,
      points: Array.isArray(row.points) ? row.points : [],
    };
  }
  const startIso = periodStartIso(period, new Date());
  const sub = sliceNavBars(sortNavBarsByDateAsc(bars), startIso);
  const points = pctPointsFromNavBars(sub);
  let total_return_pct: number | null = null;
  if (points.length >= 2) {
    total_return_pct = points[points.length - 1].pct_vs_start;
  } else if (points.length === 1) {
    total_return_pct = 0;
  }
  return {
    ...row,
    points,
    total_return_pct,
  };
}

/** A partir de la respuesta cruda del backend (~5y + nav_bars), deriva items para la ventana `period` sin red. */
export function sliceBenchmarksForPeriod(
  raw: BenchmarksResponse,
  period: BenchmarkPeriod,
): BenchmarksResponse {
  const items = (raw.items ?? []).map((it) => materializeItemForPeriod(it, period));
  const crypto_items = (raw.crypto_items ?? []).map((it) => materializeItemForPeriod(it, period));
  return {
    ...raw,
    period,
    range: period,
    interval: INTERVAL_BY_PERIOD[period] ?? '1wk',
    items,
    crypto_items,
  };
}
