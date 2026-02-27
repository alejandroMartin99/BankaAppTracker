import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Transaction } from '../../models/transaction.model';
import { TransactionService } from '../../services/transaction.service';

@Component({
  selector: 'app-ajustes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ajustes.component.html',
  styleUrl: './ajustes.component.scss'
})
export class AjustesComponent implements OnInit {
  transactions: Transaction[] = [];
  loading = false;
  error: string | null = null;

  /** ids en guardado */
  private savingKeys = new Set<string>();

  /** texto de búsqueda para el editor general */
  searchText = '';

  constructor(private transactionService: TransactionService) {}

  ngOnInit(): void {
    this.loadTransactions();
  }

  private txKey(t: Transaction): string {
    return String(t.id ?? t.transaction_id ?? '');
  }

  isSaving(t: Transaction): boolean {
    return this.savingKeys.has(this.txKey(t));
  }

  loadTransactions(): void {
    this.loading = true;
    this.error = null;
    this.transactionService.getTransactions().subscribe({
      next: (res) => {
        const raw = res?.data;
        const arr = Array.isArray(raw) ? raw : (Array.isArray((raw as any)?.data) ? (raw as any).data : []);
        this.transactions = arr.map((t: any) => ({
          id: t.id,
          transaction_id: t.transaction_id,
          dt_date: t.dt_date || t.transaction_date || '',
          importe: typeof t.importe === 'number' ? t.importe : parseFloat(t.importe) || 0,
          saldo: t.saldo != null ? (typeof t.saldo === 'number' ? t.saldo : parseFloat(t.saldo)) : undefined,
          cuenta: t.cuenta || t.account_number,
          descripcion: t.descripcion || t.description || '',
          categoria: t.categoria || t.category || '',
          subcategoria: t.subcategoria || t.Subcategoria || ''
        }));
        this.loading = false;
      },
      error: (err) => {
        console.error('[Ajustes] error loadTransactions', err);
        this.error = err.error?.detail || 'Error al cargar transacciones';
        this.loading = false;
      }
    });
  }

  get uncategorizedTransactions(): Transaction[] {
    return this.transactions
      .filter(t => !t.categoria || !t.categoria.toString().trim())
      .sort((a, b) => (b.dt_date || '').localeCompare(a.dt_date || ''));
  }

  get allCategories(): string[] {
    const set = new Set<string>();
    for (const t of this.transactions) {
      const c = (t.categoria || '').toString().trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  get filteredTransactions(): Transaction[] {
    let list = [...this.transactions];
    if (this.searchText && this.searchText.trim()) {
      const q = this.searchText.trim().toLowerCase();
      list = list.filter(t =>
        (t.descripcion || '').toLowerCase().includes(q) ||
        (t.categoria || '').toLowerCase().includes(q) ||
        (t.subcategoria || '').toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => (b.dt_date || '').localeCompare(a.dt_date || ''));
  }

  saveCategory(t: Transaction): void {
    if (!t.id) {
      return;
    }
    const key = this.txKey(t);
    this.savingKeys.add(key);
    const categoria = (t.categoria || '').toString().trim() || null;
    const subcategoria = (t.subcategoria || '').toString().trim() || null;

    this.transactionService.updateTransactionCategory(t.id, categoria, subcategoria).subscribe({
      next: () => {
        this.savingKeys.delete(key);
      },
      error: (err) => {
        console.error('[Ajustes] error saveCategory', err);
        this.error = err.error?.detail || 'Error al guardar categoría';
        this.savingKeys.delete(key);
      }
    });
  }
}
