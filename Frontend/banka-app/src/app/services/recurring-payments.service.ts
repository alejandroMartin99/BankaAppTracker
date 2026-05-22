import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environment';

export type RecurringPaymentStatus = 'paid' | 'pending' | 'overdue';

export interface RecurringPaymentItem {
  pattern_key: string;
  label: string;
  typical_amount: number;
  expected_day_of_month: number;
  expected_date: string;
  status: RecurringPaymentStatus;
  amount_cv?: number;
  occurrence_count?: number;
  paid_transaction_id?: number | null;
  paid_date?: string | null;
  paid_amount?: number | null;
}

export interface RecurringPaymentsResponse {
  success: boolean;
  month: string;
  items: RecurringPaymentItem[];
  summary: {
    paid: number;
    pending: number;
    overdue: number;
    total: number;
  };
}

@Injectable({ providedIn: 'root' })
export class RecurringPaymentsService {
  private readonly baseUrl = `${environment.apiUrl}/GET/recurring-payments`;

  constructor(private http: HttpClient) {}

  getRecurringPayments(month: string): Observable<RecurringPaymentsResponse> {
    const params = new HttpParams().set('month', month);
    return this.http.get<RecurringPaymentsResponse>(this.baseUrl, { params });
  }

  dismissPattern(patternKey: string, label?: string): Observable<{ success: boolean; pattern_key: string }> {
    return this.http.patch<{ success: boolean; pattern_key: string }>(`${this.baseUrl}/dismiss`, {
      pattern_key: patternKey,
      label: label ?? patternKey,
    });
  }
}
