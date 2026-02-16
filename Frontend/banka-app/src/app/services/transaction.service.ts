import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { Transaction, TransactionResponse, TransactionQueryParams, BalancesResponse } from '../models/transaction.model';
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
  private balancesUrl = `${this.apiUrl}/GET/balances`;
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
}