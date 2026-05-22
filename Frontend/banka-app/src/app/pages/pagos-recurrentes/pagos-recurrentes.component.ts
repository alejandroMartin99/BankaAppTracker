import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  RecurringPaymentItem,
  RecurringPaymentsService,
} from '../../services/recurring-payments.service';
import { getTransactionIconInfo } from '../../utils/transaction-icons';

@Component({
  selector: 'app-pagos-recurrentes',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pagos-recurrentes.component.html',
  styleUrl: './pagos-recurrentes.component.scss',
})
export class PagosRecurrentesComponent implements OnInit {
  loading = false;
  error: string | null = null;
  monthYm = '';
  monthLabel = '';
  items: RecurringPaymentItem[] = [];
  summary = { paid: 0, pending: 0, overdue: 0, total: 0 };
  dismissingKey: string | null = null;

  constructor(private recurring: RecurringPaymentsService) {}

  ngOnInit(): void {
    const now = new Date();
    this.monthYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.recurring.getRecurringPayments(this.monthYm).subscribe({
      next: (res) => {
        this.items = res.items ?? [];
        this.summary = res.summary ?? { paid: 0, pending: 0, overdue: 0, total: 0 };
        this.monthLabel = this.formatMonthLabel(res.month || this.monthYm);
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.detail || 'No se pudieron cargar los pagos recurrentes.';
        this.loading = false;
      },
    });
  }

  prevMonth(): void {
    this.shiftMonth(-1);
  }

  nextMonth(): void {
    this.shiftMonth(1);
  }

  private shiftMonth(delta: number): void {
    const [y, m] = this.monthYm.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    this.monthYm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    this.load();
  }

  dismiss(item: RecurringPaymentItem): void {
    if (this.dismissingKey) return;
    this.dismissingKey = item.pattern_key;
    this.recurring.dismissPattern(item.pattern_key, item.label).subscribe({
      next: () => {
        this.items = this.items.filter((i) => i.pattern_key !== item.pattern_key);
        this.refreshSummary();
        this.dismissingKey = null;
      },
      error: () => {
        this.error = 'No se pudo ocultar este patrón.';
        this.dismissingKey = null;
      },
    });
  }

  iconFor(item: RecurringPaymentItem) {
    return getTransactionIconInfo({ subcategoria: item.label, descripcion: item.label });
  }

  statusLabel(status: string): string {
    if (status === 'paid') return 'Pagado';
    if (status === 'overdue') return 'Vencido';
    return 'Pendiente';
  }

  expectedLabel(iso: string): string {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  }

  paidLabel(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso.includes('T') ? iso : iso + 'T12:00:00');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  }

  private formatMonthLabel(ym: string): string {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    const s = d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  private refreshSummary(): void {
    this.summary = {
      paid: this.items.filter((i) => i.status === 'paid').length,
      pending: this.items.filter((i) => i.status === 'pending').length,
      overdue: this.items.filter((i) => i.status === 'overdue').length,
      total: this.items.length,
    };
  }
}
