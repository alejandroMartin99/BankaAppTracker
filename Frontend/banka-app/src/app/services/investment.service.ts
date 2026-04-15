import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environment';

export type BenchmarkPeriod = 'ytd' | '1m' | '6m' | '1y' | '3y' | '5y';

export interface BenchmarkPoint {
  date: string;
  pct_vs_start: number;
}

/**
 * Cierre diario (o agregado) en **precio / NAV absoluto** (>0), misma unidad todos los días.
 * El % acumulado respecto al inicio de la ventana es `(close/cierre_inicial - 1)*100` y **no** está acotado a ±100.
 */
export interface BenchmarkNavBar {
  date: string;
  close: number;
}

/** Clasificación aproximada enviada por el backend */
export type BenchmarkClasificacion =
  | 'renta_variable'
  | 'renta_fija'
  | 'fondos_monetarios'
  | 'criptoactivos';

export interface BenchmarkItem {
  isin: string;
  symbol: string;
  name: string;
  clasificacion?: BenchmarkClasificacion | string;
  total_return_pct: number | null;
  points: BenchmarkPoint[];
  nav_bars?: BenchmarkNavBar[];
}

export interface BenchmarksResponse {
  success: boolean;
  period: string;
  range?: string;
  interval?: string;
  source?: string;
  items: BenchmarkItem[];
  errors: { isin: string; detail: string }[];
  crypto_items?: BenchmarkItem[];
  crypto_errors?: { symbol: string; detail: string }[];
  /** True si no hay filas en Supabase y se usan los ISIN por defecto del autor */
  using_default_watchlist?: boolean;
}

export interface InvestmentFundRow {
  isin: string;
  sort_order?: number;
  created_at?: string;
}

export interface InvestmentFundsResponse {
  success: boolean;
  items: InvestmentFundRow[];
  default_isins: string[];
  max_funds: number;
}

/** Cuerpo de la ficha ampliada (yfinance + caché en backend). */
export interface FundDetailPayload {
  yahoo_symbol: string;
  cache_key: string;
  info: Record<string, unknown>;
  composition: Record<string, unknown> | null;
  fund_operations: unknown;
  mutualfund_holders: unknown;
  composition_error: string | null;
}

export interface FundDetailResponse {
  success: boolean;
  cached?: boolean;
  cache_key?: string;
  yahoo_symbol?: string;
  updated_at?: string | null;
  detail?: FundDetailPayload;
}

@Injectable({ providedIn: 'root' })
export class InvestmentService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;
  private readonly benchmarksUrl = `${this.apiUrl}/GET/investment/benchmarks`;
  private readonly fundsUrl = `${this.apiUrl}/GET/investment/funds`;
  private readonly fundDetailUrl = `${this.apiUrl}/GET/investment/fund-detail`;

  /** Siempre horizonte completo en caché; el periodo se aplica en el cliente. */
  getBenchmarks(): Observable<BenchmarksResponse> {
    return this.http.get<BenchmarksResponse>(this.benchmarksUrl);
  }

  getFunds(): Observable<InvestmentFundsResponse> {
    return this.http.get<InvestmentFundsResponse>(this.fundsUrl);
  }

  addFund(isin: string): Observable<{ success: boolean; isin: string }> {
    return this.http.post<{ success: boolean; isin: string }>(this.fundsUrl, { isin });
  }

  removeFund(isin: string): Observable<{ success: boolean; isin: string }> {
    const enc = encodeURIComponent(isin.toUpperCase());
    return this.http.delete<{ success: boolean; isin: string }>(`${this.fundsUrl}/${enc}`);
  }

  /** Exactamente uno de `isin` o `symbol` (cripto, par Yahoo). */
  getFundDetail(isin?: string | null, symbol?: string | null): Observable<FundDetailResponse> {
    let params = new HttpParams();
    if (isin?.trim()) {
      params = params.set('isin', isin.trim().toUpperCase());
    } else if (symbol?.trim()) {
      params = params.set('symbol', symbol.trim());
    }
    return this.http.get<FundDetailResponse>(this.fundDetailUrl, { params });
  }
}
