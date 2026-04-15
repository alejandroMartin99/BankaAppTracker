import type {
  BenchmarkItem,
  BenchmarkPeriod,
  BenchmarkPoint,
  BenchmarksResponse,
} from '../services/investment.service';

export type NavBar = { date: string; close: number };

const INTERVAL_BY_PERIOD: Record<BenchmarkPeriod, string> = {
  ytd: '1d',
  '1m': '1d',
  '6m': '1d',
  '1y': '1mo',
  '3y': '1mo',
  '5y': '1d',
  max: '1mo',
};

function periodStartIso(period: BenchmarkPeriod, now: Date): string | null {
  if (period === 'max') return null;
  const dayMs = 86400000;
  if (period === 'ytd') {
    return `${now.getFullYear()}-01-01`;
  }
  if (period === '1m') {
    const t = new Date(now.getTime() - 32 * dayMs);
    return t.toISOString().slice(0, 10);
  }
  if (period === '6m') {
    const t = new Date(now.getTime() - 183 * dayMs);
    return t.toISOString().slice(0, 10);
  }
  if (period === '1y') {
    const t = new Date(now.getTime() - 365 * dayMs);
    return t.toISOString().slice(0, 10);
  }
  if (period === '3y') {
    const t = new Date(now.getTime() - 365 * 3 * dayMs);
    return t.toISOString().slice(0, 10);
  }
  if (period === '5y') {
    const t = new Date(now.getTime() - 365 * 5 * dayMs);
    return t.toISOString().slice(0, 10);
  }
  return null;
}

function sliceNavBars(bars: NavBar[], startIso: string | null): NavBar[] {
  if (!startIso) return [...bars];
  return bars.filter((b) => (b.date || '') >= startIso);
}

/** Quita cierres con saltos imposibles (mismo criterio que el backend). */
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
      if (ratio < 0.05 || ratio > 25) {
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

function pctPointsFromNavBars(bars: NavBar[]): BenchmarkPoint[] {
  const cleaned = sanitizeNavBars(bars);
  const first = cleaned.find((b) => typeof b.close === 'number' && b.close > 0)?.close;
  if (first == null || first <= 0) return [];
  return cleaned.map((b) => {
    const rawPct = (b.close / first - 1) * 100;
    const pct_vs_start = Math.round(Math.max(-100, Math.min(5e6, rawPct)) * 100) / 100;
    return { date: b.date, pct_vs_start };
  });
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
  const sub = sliceNavBars(bars, startIso);
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
