export interface Transaction {
  id?: number;
  transaction_id?: string;
  dt_date: string;
  importe: number;
  saldo?: number;
  cuenta?: string;
  descripcion?: string;
  categoria?: string;
  subcategoria?: string;
  bizum_mensaje?: string;
  referencia?: string;
  /** Transferencia entre cuentas propias (Revolut/Personal/Conjunta); no afecta balances */
  es_transferencia_interna?: boolean;
  /** En gastos compartidos: true = cuenta del usuario actual, false = cuenta de otro usuario que comparte */
  is_own_account?: boolean;
}

export interface TransactionResponse {
  success: boolean;
  count: number;
  limit?: number;
  offset?: number;
  data: Transaction[];
}

export interface TransactionQueryParams {
  from_date?: string;
  to_date?: string;
  limit?: number;
  offset?: number;
}

export interface BalancesResponse {
  success: boolean;
  data: Record<string, number>;
}

export interface Account {
  id: string;
  display_name: string;
  stable_key?: string;
  source?: string;
  shared?: boolean;
}

export interface AccountsResponse {
  success: boolean;
  data: Account[];
}
