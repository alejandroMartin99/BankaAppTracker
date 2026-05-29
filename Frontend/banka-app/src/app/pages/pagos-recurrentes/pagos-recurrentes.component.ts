import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  RecurringPaymentHistoryPoint,
  RecurringPaymentItem,
  RecurringPaymentsService,
} from '../../services/recurring-payments.service';
import { TransactionService } from '../../services/transaction.service';
import { getTransactionIconInfo } from '../../utils/transaction-icons';
import { PrivacyService } from '../../services/privacy.service';

interface RecurringCategoryGroup {
  categoria: string;
  items: RecurringPaymentItem[];
}

interface ChartDot {
  x: number;
  y: number;
}

const CATEGORY_ORDER = ['Nómina', 'Nomina', 'Vivienda', 'Seguros', 'Suministros', 'Formación', 'Formacion'];

@Component({
  selector: 'app-pagos-recurrentes',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pagos-recurrentes.component.html',
  styleUrl: './pagos-recurrentes.component.scss',
})
export class PagosRecurrentesComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  loading = false;
  error: string | null = null;
  monthYm = '';
  monthLabel = '';
  items: RecurringPaymentItem[] = [];

  detailOpen = false;
  detailLoading = false;
  detailError: string | null = null;
  detailItem: RecurringPaymentItem | null = null;
  detailHistory: RecurringPaymentHistoryPoint[] = [];
  detailUsualCuenta: string | null = null;

  constructor(
    private recurring: RecurringPaymentsService,
    private transactionService: TransactionService,
    public privacy: PrivacyService,
  ) {}

  ngOnInit(): void {
    const now = new Date();
    this.monthYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    this.monthLabel = this.formatMonthLabel(this.monthYm);
    this.load();
    this.transactionService.dataRefresh$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.load());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get groupedByCategory(): RecurringCategoryGroup[] {
    const map = new Map<string, RecurringPaymentItem[]>();
    for (const item of this.items) {
      const cat = item.categoria?.trim() || 'Otros';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    return [...map.entries()]
      .sort(([a], [b]) => {
        const ia = CATEGORY_ORDER.indexOf(a);
        const ib = CATEGORY_ORDER.indexOf(b);
        const ra = ia >= 0 ? ia : 99;
        const rb = ib >= 0 ? ib : 99;
        if (ra !== rb) return ra - rb;
        return a.localeCompare(b, 'es');
      })
      .map(([categoria, items]) => ({ categoria, items }));
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.recurring.getRecurringPayments(this.monthYm).subscribe({
      next: (res) => {
        this.items = (res.items ?? []).map((i) => ({
          ...i,
          status: i.status === 'overdue' ? 'pending' : i.status,
        }));
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.detail || 'No se pudieron cargar los pagos recurrentes.';
        this.loading = false;
      },
    });
  }

  openDetail(item: RecurringPaymentItem): void {
    this.detailItem = item;
    this.detailOpen = true;
    this.detailLoading = true;
    this.detailError = null;
    this.detailHistory = [];
    this.detailUsualCuenta = item.usual_cuenta ?? null;
    this.recurring.getHistory(item.pattern_key).subscribe({
      next: (res) => {
        this.detailHistory = res.history ?? [];
        this.detailUsualCuenta = res.usual_cuenta ?? item.usual_cuenta ?? null;
        this.detailLoading = false;
      },
      error: (err) => {
        this.detailError = err.error?.detail || 'No se pudo cargar el histórico.';
        this.detailLoading = false;
      },
    });
  }

  closeDetail(): void {
    this.detailOpen = false;
    this.detailItem = null;
    this.detailHistory = [];
    this.detailError = null;
  }

  iconFor(item: RecurringPaymentItem) {
    return getTransactionIconInfo({
      categoria: item.categoria ?? undefined,
      subcategoria: item.label,
      descripcion: item.label,
    });
  }

  isIncome(item: RecurringPaymentItem): boolean {
    return item.kind === 'income' || item.typical_amount > 0;
  }

  isPending(item: RecurringPaymentItem): boolean {
    return item.status !== 'paid';
  }

  statusLabel(item: RecurringPaymentItem): string {
    if (item.status === 'paid') return this.isIncome(item) ? 'Cobrado' : 'Pagado';
    return 'Pendiente';
  }

  expectedLabel(iso: string): string {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  }

  amountLabel(item: RecurringPaymentItem): string {
    const abs = Math.abs(item.typical_amount).toLocaleString('es-ES', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const v = this.privacy.hideBalances()
      ? '***'
      : `${this.isIncome(item) ? '+' : '-'}${abs} €`;
    return this.isPending(item) ? `aprox. ${v}` : v;
  }

  dateLabel(item: RecurringPaymentItem): string {
    const d = this.expectedLabel(item.expected_date);
    return this.isPending(item) ? `aprox. ${d}` : d;
  }

  historyMonthLabel(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso.includes('T') ? iso : iso + 'T12:00:00');
    return d.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
  }

  cuentaLabel(item: RecurringPaymentItem): string | null {
    if (item.status === 'paid' && item.paid_cuenta) return item.paid_cuenta;
    return item.usual_cuenta ?? null;
  }

  private chartCoords(): ChartDot[] {
    const pts = this.detailHistory.filter((p) => p.date);
    if (!pts.length) return [];
    const minX = 4;
    const maxX = 96;
    const minY = 4;
    const maxY = 36;
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const vals = pts.map((p) => Math.abs(p.amount));
    const max = Math.max(...vals, 1) * 1.08;
    const n = Math.max(pts.length - 1, 1);
    return pts.map((p, i) => ({
      x: minX + (i / n) * spanX,
      y: maxY - (Math.abs(p.amount) / max) * spanY,
    }));
  }

  get chartPolyline(): string {
    return this.chartCoords()
      .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(' ');
  }

  get chartDots(): ChartDot[] {
    return this.chartCoords();
  }

  get chartAreaPoints(): string {
    const line = this.chartPolyline;
    if (!line) return '';
    return `4,36 ${line} 96,36`;
  }

  get chartYTicks(): number[] {
    const pts = this.detailHistory;
    if (!pts.length) return [];
    const max = Math.max(...pts.map((p) => Math.abs(p.amount)), 1);
    return [max, max * 0.5, 0].map((v) => Math.round(v));
  }

  get chartXLabels(): string[] {
    return this.detailHistory.filter((p) => p.date).map((p) => this.historyMonthLabel(p.date));
  }

  private formatMonthLabel(ym: string): string {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    const s = d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}
