import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { Transaction, TransactionResponse, TransactionQueryParams, BalancesResponse, AccountsResponse } from '../models/transaction.model';
import { environment } from '../../environment';

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
  private balancesUrl = `${this.apiUrl}/GET/balances`;
   private accountsUrl = `${this.apiUrl}/GET/accounts`;
  private uploadUrl = `${this.apiUrl}/upload/Transactions`;

  /** Emitido tras subir archivo para refrescar datos */
  readonly dataRefresh$ = new Subject<void>();

  constructor(private http: HttpClient) {}

  /**
   * Sube archivo de extracto (Excel o CSV) para importar transacciones
   */
  uploadTransactions(file: File): Observable<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<UploadResponse>(this.uploadUrl, formData);
  }

  getBalances(): Observable<BalancesResponse> {
    return this.http.get<BalancesResponse>(this.balancesUrl);
  }

  /**
   * Obtiene las cuentas vinculadas al usuario actual.
   */
  getAccounts(): Observable<AccountsResponse> {
    return this.http.get<AccountsResponse>(this.accountsUrl);
  }

  /**
   * Obtiene transacciones con filtros opcionales
   * @param params Parámetros de consulta (from_date, to_date, limit, offset)
   */
  getTransactions(params?: TransactionQueryParams): Observable<TransactionResponse> {
    let httpParams = new HttpParams();

    if (params) {
      if (params.from_date) {
        httpParams = httpParams.set('from_date', params.from_date);
      }
      if (params.to_date) {
        httpParams = httpParams.set('to_date', params.to_date);
      }
      if (params.limit) {
        httpParams = httpParams.set('limit', params.limit.toString());
      }
      if (params.offset !== undefined) {
        httpParams = httpParams.set('offset', params.offset.toString());
      }
    }

    return this.http.get<TransactionResponse>(this.transactionsUrl, { params: httpParams });
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
   * Transacciones para análisis de gastos compartidos: propias + de usuarios que comparten alguna cuenta.
   * Cada item incluye is_own_account.
   */
  getSharedTransactions(params?: { from_date?: string; to_date?: string }): Observable<TransactionResponse> {
    let httpParams = new HttpParams();
    if (params?.from_date) httpParams = httpParams.set('from_date', params.from_date);
    if (params?.to_date) httpParams = httpParams.set('to_date', params.to_date);
    return this.http.get<TransactionResponse>(this.sharedTransactionsUrl, { params: httpParams });
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