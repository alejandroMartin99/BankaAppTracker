import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { forkJoin, Observable, Subject, of } from 'rxjs';
import { concatMap, map, tap } from 'rxjs/operators';
import {
  Transaction,
  TransactionResponse,
  TransactionQueryParams,
  BalancesResponse,
  AccountsResponse,
} from '../models/transaction.model';
import { environment } from '../../environment';

/** TTL caché en memoria de GET transactions y GET balances (ms); invalidación vía `dataRefresh$` y logout. */
const TRANSACTIONS_CACHE_TTL_MS = 15 * 60 * 1000;

/** Respuesta de GET /GET/category-catalog (transacciones del usuario en BD + reglas del importador). */
export interface CategoryCatalogResponse {
  success: boolean;
  categories: string[];
  subcategories_by_category: Record<string, string[]>;
}

export interface SharedPartnerInfo {
  user_id: string;
  display_name: string;
  account_names: string[];
}

export interface SharedTransactionsResponse extends TransactionResponse {
  shared_with_user_name?: string | null;
  shared_balances_enabled?: boolean;
  partners?: SharedPartnerInfo[];
  partner_accounts_linked?: boolean;
  joint_account_names?: string[];
}

export interface MortgageSettings {
  principal: number;
  annual_rate: number;
  term_years: number;
}

export interface MortgageReceiptState {
  transaction_id: number;
  confirmed: boolean;
  included_in_calculation: boolean;
}

export interface MortgageConfigResponse {
  success: boolean;
  settings: MortgageSettings;
  receipts: MortgageReceiptState[];
}

export interface UploadResponse {
  success: boolean;
  filename?: string;
  /** Tipo de extracto detectado: 'Revolut' | 'Ibercaja' */
  source_type?: string;
  summary?: {
    total_received: number;
    total_inserted: number;
    total_duplicates: number;
  };
}

@Injectable({
  providedIn: 'root'
})
export class TransactionService {
  private apiUrl = environment.apiUrl;
  private transactionsUrl = `${this.apiUrl}/GET/transactions`;
  private sharedTransactionsUrl = `${this.apiUrl}/GET/shared-transactions`;
  private categoryCatalogUrl = `${this.apiUrl}/GET/category-catalog`;
  private mortgageUrl = `${this.apiUrl}/GET/mortgage`;
  private balancesUrl = `${this.apiUrl}/GET/balances`;
   private accountsUrl = `${this.apiUrl}/GET/accounts`;
  private uploadUrl = `${this.apiUrl}/upload/Transactions`;

  /** Emitido tras subir archivo para refrescar datos */
  readonly dataRefresh$ = new Subject<void>();

  /**
   * Snapshot completo del GET /transactions (sin filtros). El backend devuelve hasta 10k filas recientes.
   * Filtros por fecha y paginación se aplican en cliente sobre esta copia.
   */
  private transactionsSnapshot: { body: TransactionResponse; storedAt: number } | null = null;

  /** Snapshot de GET /balances (saldos por cuenta mostrados en Gastos). */
  private balancesSnapshot: { body: BalancesResponse; storedAt: number } | null = null;

  constructor(private http: HttpClient) {
    this.dataRefresh$.subscribe(() => this.clearTransactionsCache());
  }

  /** Vacía caché de transacciones y saldos (logout, invalidación explícita). */
  clearTransactionsCache(): void {
    this.transactionsSnapshot = null;
    this.balancesSnapshot = null;
  }

  /** Tras mutaciones (upload, edición masiva): limpia caché y avisa a las pantallas. */
  notifyDataChanged(): void {
    this.clearTransactionsCache();
    this.dataRefresh$.next();
  }

  private cloneTransactionResponse(r: TransactionResponse): TransactionResponse {
    return structuredClone(r);
  }

  private cloneBalancesResponse(r: BalancesResponse): BalancesResponse {
    return structuredClone(r);
  }

  private txDay(dt: string | undefined | null): string {
    const s = (dt ?? '').toString().trim();
    if (!s) return '';
    return s.length >= 10 ? s.slice(0, 10) : s;
  }

  private rowInDateRange(row: Transaction, from?: string, to?: string): boolean {
    const d = this.txDay(row.dt_date ?? (row as { transaction_date?: string }).transaction_date);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  }

  /**
   * Aplica from/to, luego limit/offset sobre el snapshot ya ordenado (desc. como el API).
   */
  private applyFiltersOnSnapshot(
    fullResponse: TransactionResponse,
    params?: TransactionQueryParams,
  ): TransactionResponse {
    const rows = Array.isArray(fullResponse.data) ? fullResponse.data : [];
    const from = params?.from_date?.trim();
    const to = params?.to_date?.trim();
    const filtered =
      from || to ? rows.filter((r) => this.rowInDateRange(r as Transaction, from, to)) : [...rows];
    const total = filtered.length;
    const limit = params?.limit;
    const offset = params?.offset ?? 0;
    let page = filtered;
    if (limit != null && limit > 0) {
      page = filtered.slice(offset, offset + limit);
    } else if (offset > 0) {
      page = filtered.slice(offset);
    }
    const out: TransactionResponse = {
      success: fullResponse.success,
      count: total,
      data: page,
    };
    if (params?.limit != null) out.limit = params.limit;
    if (params?.offset !== undefined) out.offset = params.offset;
    return out;
  }

  private fetchTransactionsPage(page: number, pageSize: number): Observable<TransactionResponse> {
    const params = new HttpParams()
      .set('page', String(page))
      .set('page_size', String(pageSize));
    return this.http.get<TransactionResponse>(this.transactionsUrl, { params });
  }

  /** Carga todas las páginas del backend (page_size=1000) para el snapshot en cliente. */
  private loadAllTransactionsFromApi(): Observable<TransactionResponse> {
    const pageSize = 1000;
    return this.fetchTransactionsPage(1, pageSize).pipe(
      concatMap((first) => {
        const firstRows = Array.isArray(first.data) ? first.data : [];
        const total = first.count ?? firstRows.length;
        const pages = Math.max(1, Math.ceil(total / pageSize));
        if (pages <= 1) {
          return of({ ...first, count: total, data: firstRows });
        }
        const restPages = Array.from({ length: pages - 1 }, (_, i) =>
          this.fetchTransactionsPage(i + 2, pageSize),
        );
        return forkJoin(restPages).pipe(
          map((responses) => {
            const allRows = [...firstRows];
            for (const r of responses) {
              if (Array.isArray(r.data)) allRows.push(...r.data);
            }
            return { ...first, success: first.success, count: total, data: allRows };
          }),
        );
      }),
      tap((body) => {
        this.transactionsSnapshot = {
          body: this.cloneTransactionResponse(body),
          storedAt: Date.now(),
        };
      }),
    );
  }

  private ensureFullTransactionsSnapshot(): Observable<TransactionResponse> {
    const now = Date.now();
    if (
      this.transactionsSnapshot &&
      now - this.transactionsSnapshot.storedAt < TRANSACTIONS_CACHE_TTL_MS
    ) {
      return of(this.cloneTransactionResponse(this.transactionsSnapshot.body));
    }
    return this.loadAllTransactionsFromApi();
  }

  /**
   * Sube archivo de extracto (Excel o CSV) para importar transacciones
   */
  uploadTransactions(file: File): Observable<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<UploadResponse>(this.uploadUrl, formData).pipe(
      tap((res) => {
        if (res?.success !== false) {
          this.notifyDataChanged();
        }
      }),
    );
  }

  getBalances(): Observable<BalancesResponse> {
    const now = Date.now();
    if (
      this.balancesSnapshot &&
      now - this.balancesSnapshot.storedAt < TRANSACTIONS_CACHE_TTL_MS
    ) {
      return of(this.cloneBalancesResponse(this.balancesSnapshot.body));
    }
    return this.http.get<BalancesResponse>(this.balancesUrl).pipe(
      tap((body) => {
        this.balancesSnapshot = {
          body: this.cloneBalancesResponse(body),
          storedAt: Date.now(),
        };
      }),
    );
  }

  /**
   * Catálogo para desplegables: valores distintos en tus transacciones (Supabase) unidos a las reglas del importador.
   */
  getCategoryCatalog(): Observable<CategoryCatalogResponse> {
    return this.http.get<CategoryCatalogResponse>(this.categoryCatalogUrl);
  }

  /**
   * Obtiene las cuentas vinculadas al usuario actual.
   */
  getAccounts(): Observable<AccountsResponse> {
    return this.http.get<AccountsResponse>(this.accountsUrl);
  }

  /**
   * Snapshot completo paginado en servidor (page_size=1000), caché TTL; filtros limit/offset en cliente.
   */
  getTransactions(params?: TransactionQueryParams): Observable<TransactionResponse> {
    return this.ensureFullTransactionsSnapshot().pipe(
      map((full) => this.applyFiltersOnSnapshot(full, params)),
    );
  }

  /**
   * Obtiene transacciones por rango de fechas
   */
  getTransactionsByDateRange(fromDate: string, toDate: string, limit: number = 50): Observable<TransactionResponse> {
    return this.getTransactions({
      from_date: fromDate,
      to_date: toDate,
      limit: limit,
      offset: 0
    });
  }

  /**
   * Obtiene transacciones con paginación
   */
  getTransactionsPaginated(page: number, pageSize: number = 50): Observable<TransactionResponse> {
    const offset = (page - 1) * pageSize;
    return this.getTransactions({
      limit: pageSize,
      offset: offset
    });
  }

  /**
   * Transacciones para gastos compartidos (propias + pareja vinculada por Conjunta + shares explícitos).
   * Carga todas las páginas del backend.
   */
  getSharedTransactions(params?: { from_date?: string; to_date?: string }): Observable<SharedTransactionsResponse> {
    const pageSize = 1000;
    let httpParams = new HttpParams().set('page', '1').set('page_size', String(pageSize));
    if (params?.from_date) httpParams = httpParams.set('from_date', params.from_date);
    if (params?.to_date) httpParams = httpParams.set('to_date', params.to_date);
    return this.http.get<SharedTransactionsResponse>(this.sharedTransactionsUrl, { params: httpParams }).pipe(
      concatMap((first) => {
        const firstRows = Array.isArray(first.data) ? first.data : [];
        const total = first.count ?? firstRows.length;
        const pages = Math.max(1, Math.ceil(total / pageSize));
        if (pages <= 1) {
          return of({ ...first, count: total, data: firstRows });
        }
        const restPages = Array.from({ length: pages - 1 }, (_, i) => {
          let p = new HttpParams()
            .set('page', String(i + 2))
            .set('page_size', String(pageSize));
          if (params?.from_date) p = p.set('from_date', params.from_date);
          if (params?.to_date) p = p.set('to_date', params.to_date);
          return this.http.get<SharedTransactionsResponse>(this.sharedTransactionsUrl, { params: p });
        });
        return forkJoin(restPages).pipe(
          map((responses) => {
            const allRows = [...firstRows];
            for (const r of responses) {
              if (Array.isArray(r.data)) allRows.push(...r.data);
            }
            return { ...first, count: total, data: allRows };
          }),
        );
      }),
    );
  }

  /** Activa/desactiva la inclusión de saldos de usuarios vinculados en Compartidos. */
  updateSharedConsent(enabled: boolean): Observable<{ success: boolean; shared_balances_enabled: boolean }> {
    return this.http.patch<{ success: boolean; shared_balances_enabled: boolean }>(
      `${this.apiUrl}/GET/shared-consent`,
      { enabled }
    );
  }

  getMortgageConfig(): Observable<MortgageConfigResponse> {
    return this.http.get<MortgageConfigResponse>(this.mortgageUrl);
  }

  updateMortgageSettings(payload: MortgageSettings): Observable<{ success: boolean; settings: MortgageSettings }> {
    return this.http.patch<{ success: boolean; settings: MortgageSettings }>(
      `${this.mortgageUrl}/settings`,
      payload
    );
  }

  updateMortgageReceipt(payload: MortgageReceiptState): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(
      `${this.mortgageUrl}/receipts`,
      payload
    );
  }

  /**
   * Actualiza categoría y subcategoría de una transacción existente (por id de fila).
   */
  updateTransactionCategory(id: number, categoria: string | null, subcategoria: string | null): Observable<{ success: boolean; updated: number }> {
    const body: any = {
      categoria,
      subcategoria
    };
    return this.http.patch<{ success: boolean; updated: number }>(`${this.transactionsUrl}/${id}/category`, body);
  }

  /**
   * Actualiza detalles de una transacción (fecha, descripción, importe). Solo se envían los campos presentes.
   */
  updateTransactionDetails(
    id: number,
    details: { dt_date?: string; descripcion?: string; importe?: number }
  ): Observable<{ success: boolean; updated: number }> {
    return this.http.patch<{ success: boolean; updated: number }>(`${this.transactionsUrl}/${id}`, details);
  }

  /**
   * Elimina una transacción por id.
   */
  deleteTransaction(id: number): Observable<{ success: boolean; deleted: number }> {
    return this.http.delete<{ success: boolean; deleted: number }>(`${this.transactionsUrl}/${id}`);
  }

  /** Elimina varias transacciones en una sola petición (backend en lotes). */
  deleteTransactionsBatch(ids: number[]): Observable<{ success: boolean; deleted: number; deleted_ids: number[] }> {
    return this.http.post<{ success: boolean; deleted: number; deleted_ids: number[] }>(
      `${this.transactionsUrl}/batch-delete`,
      { ids }
    );
  }

  /** Aplica la misma categoría/subcategoría a varias filas en una sola petición. */
  updateTransactionsCategoryBatch(
    ids: number[],
    categoria: string | null,
    subcategoria: string | null
  ): Observable<{ success: boolean; updated: number; updated_ids: number[] }> {
    return this.http.post<{ success: boolean; updated: number; updated_ids: number[] }>(
      `${this.transactionsUrl}/batch-category`,
      { ids, categoria, subcategoria }
    );
  }

  /**
   * Actualiza el nombre visible de una cuenta.
   */
  updateAccountName(accountId: string, displayName: string): Observable<{ success: boolean; updated: number; display_name: string }> {
    return this.http.patch<{ success: boolean; updated: number; display_name: string }>(
      `${this.accountsUrl}/${accountId}`,
      { display_name: displayName }
    );
  }
}