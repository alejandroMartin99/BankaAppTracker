import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { Transaction } from '../../models/transaction.model';

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './transactions.component.html',
  styleUrl: './transactions.component.scss'
})
export class TransactionsComponent implements OnInit {
  transactions: Transaction[] = [];
  loading = false;
  error: string | null = null;

  currentPage = 1;
  pageSize = 50;
  totalCount = 0;

  fromDate = '';
  toDate = '';

  constructor(private transactionService: TransactionService) {}

  ngOnInit() {
    this.loadTransactions();
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  loadTransactions() {
    this.loading = true;
    this.error = null;

    this.transactionService.getTransactions({
      from_date: this.fromDate || undefined,
      to_date: this.toDate || undefined,
      limit: this.pageSize,
      offset: (this.currentPage - 1) * this.pageSize
    }).subscribe({
      next: (response) => {
        if (response.success) {
          this.transactions = response.data;
          this.totalCount = response.count;
        }
        this.loading = false;
      },
      error: (err) => {
        console.error('Error al cargar transacciones:', err);
        this.error = err.error?.detail || 'Error al conectar con el servidor. ¿Está el backend en http://localhost:8000?';
        this.loading = false;
      }
    });
  }

  previousPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.loadTransactions();
    }
  }

  nextPage() {
    this.currentPage++;
    this.loadTransactions();
  }

  clearFilters() {
    this.fromDate = '';
    this.toDate = '';
    this.currentPage = 1;
    this.loadTransactions();
  }
}
