import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { Transaction } from '../../models/transaction.model';
import { PrivacyService } from '../../services/privacy.service';

interface MortgageInstallmentRow {
  index: number;
  dueDate: Date;
  payment: number;
  principal: number;
  interest: number;
  remaining: number;
  interestRemaining: number;
  paid: boolean;
}

interface LinePoint {
  x: number;
  y: number;
  paid: boolean;
}

@Component({
  selector: 'app-hipotecas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './hipotecas.component.html',
  styleUrl: './hipotecas.component.scss'
})
export class HipotecasComponent implements OnInit {
  principal = 180000;
  annualRate = 3.2;
  termYears = 30;

  loading = false;
  error: string | null = null;
  transactions: Transaction[] = [];
  receiptStateByTx: Record<number, { confirmed: boolean; included_in_calculation: boolean }> = {};
  savingSettings = false;
  savingReceiptIds: Record<number, boolean> = {};
  settingsSaveMessage: string | null = null;
  settingsSaveError: string | null = null;
  editingConditions = false;
  chartMode: 'curve' | 'bars' = 'curve';
  showDetectedReceiptsModal = false;
  mortgageConfigResolved = false;

  constructor(
    private transactionService: TransactionService,
    public privacy: PrivacyService
  ) {}

  ngOnInit(): void {
    this.loadMortgageConfig();
    this.loadTransactions();
  }

  get termMonths(): number {
    return Math.max(1, Math.round((this.termYears || 0) * 12));
  }

  get monthlyRate(): number {
    return Math.max(0, (this.annualRate || 0) / 100 / 12);
  }

  get monthlyInstallment(): number {
    const p = Math.max(0, this.principal || 0);
    const n = this.termMonths;
    const r = this.monthlyRate;
    if (p <= 0 || n <= 0) return 0;
    if (r === 0) return p / n;
    const factor = Math.pow(1 + r, n);
    return (p * r * factor) / (factor - 1);
  }

  get includedMortgageTxs(): Transaction[] {
    return this.detectedMortgageTxs.filter((t) => this.getReceiptState(t).included_in_calculation);
  }

  get confirmedIncludedTxs(): Transaction[] {
    return this.includedMortgageTxs.filter((t) => this.isConfirmed(t));
  }

  get pendingReviewTxs(): Transaction[] {
    return this.detectedMortgageTxs.filter((t) => this.isIncluded(t) && !this.isConfirmed(t));
  }

  get archivedTxs(): Transaction[] {
    return this.detectedMortgageTxs.filter((t) => !this.isIncluded(t) || this.isConfirmed(t));
  }

  get detectedMortgageTxs(): Transaction[] {
    return this.transactions
      .filter((t) => {
        const sub = String(t.subcategoria || '').trim().toLowerCase();
        // Solo recibos de cargo (gasto). Excluimos abonos/devoluciones para no distorsionar la comparación.
        return sub === 'hipoteca' && (t.importe || 0) < 0;
      })
      .sort((a, b) => (b.dt_date || '').localeCompare(a.dt_date || ''));
  }

  isConfirmed(tx: Transaction): boolean {
    return this.getReceiptState(tx).confirmed;
  }

  isIncluded(tx: Transaction): boolean {
    return this.getReceiptState(tx).included_in_calculation;
  }

  get confirmedCount(): number {
    return this.includedMortgageTxs.filter((t) => this.isConfirmed(t)).length;
  }

  get hasMortgageConfirmed(): boolean {
    return this.confirmedIncludedTxs.length > 0 && this.monthlyInstallment > 0;
  }

  get showMainSummaryBlock(): boolean {
    if (!this.mortgageConfigResolved) return true;
    return this.hasMortgageConfirmed && !this.editingConditions;
  }

  get avgDetectedAmount(): number {
    const list = this.includedMortgageTxs;
    if (!list.length) return 0;
    const sum = list.reduce((acc, t) => acc + Math.abs(t.importe || 0), 0);
    return +(sum / list.length).toFixed(2);
  }

  getAmountDeltaVsExpected(tx: Transaction): number {
    if (this.monthlyInstallment <= 0) return 0;
    const raw = this.getAbsAmount(tx) - this.monthlyInstallment;
    const roundedToCents = Math.round(raw * 100) / 100;
    // Evita "-0,00" por residuos de coma flotante
    return Math.abs(roundedToCents) < 0.005 ? 0 : roundedToCents;
  }

  get paidInstallmentsCount(): number {
    return Math.min(this.confirmedIncludedTxs.length, this.termMonths);
  }

  get amortizationSchedule(): MortgageInstallmentRow[] {
    const p = Math.max(0, this.principal || 0);
    const n = this.termMonths;
    const r = this.monthlyRate;
    const payment = this.monthlyInstallment;
    if (p <= 0 || n <= 0 || payment <= 0) return [];

    const schedule: MortgageInstallmentRow[] = [];
    let remaining = p;
    const startDate = this.getMortgageStartDate();
    const paidCount = this.paidInstallmentsCount;

    for (let i = 1; i <= n; i++) {
      const interest = r > 0 ? remaining * r : 0;
      let principalPart = payment - interest;
      if (i === n) {
        principalPart = remaining;
      }
      remaining = Math.max(0, remaining - principalPart);
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + (i - 1));
      schedule.push({
        index: i,
        dueDate,
        payment,
        principal: principalPart,
        interest,
        remaining,
        interestRemaining: 0,
        paid: i <= paidCount,
      });
    }
    // Interés restante desde cada cuota hacia el final
    let accInterest = 0;
    for (let i = schedule.length - 1; i >= 0; i--) {
      accInterest += schedule[i].interest;
      schedule[i].interestRemaining = accInterest;
    }
    return schedule;
  }

  get remainingInstallments(): number {
    return Math.max(0, this.termMonths - this.paidInstallmentsCount);
  }

  get remainingPrincipal(): number {
    const row = this.amortizationSchedule[this.paidInstallmentsCount - 1];
    if (!row) return Math.max(0, this.principal || 0);
    return Math.max(0, row.remaining);
  }

  get totalInterestRemaining(): number {
    return this.amortizationSchedule
      .filter((r) => !r.paid)
      .reduce((sum, r) => sum + r.interest, 0);
  }

  get lineChartRows(): MortgageInstallmentRow[] {
    return this.amortizationSchedule;
  }

  get lineChartMaxY(): number {
    const rows = this.lineChartRows;
    if (!rows.length) return 1;
    const max = rows.reduce((m, r) => Math.max(m, r.remaining, r.interestRemaining), 0);
    return max <= 0 ? 1 : max;
  }

  get lineChartCapitalPendingPoints(): LinePoint[] {
    return this.buildLinePoints(this.lineChartRows.map(r => r.remaining));
  }

  get lineChartInterestRemainingPoints(): LinePoint[] {
    return this.buildLinePoints(this.lineChartRows.map(r => r.interestRemaining));
  }

  get lineChartPaidPoints(): LinePoint[] {
    const rows = this.lineChartRows;
    const maxY = this.lineChartMaxY;
    const w = 100;
    const h = 40;
    const n = rows.length;
    if (!n) return [];
    return rows.map((r, i) => ({
      x: n === 1 ? 0 : (i / (n - 1)) * w,
      y: h - ((r.payment / maxY) * h),
      paid: r.paid,
    }));
  }

  get yearTickPoints(): Array<{ x: number; label: string }> {
    const rows = this.lineChartRows;
    if (!rows.length) return [];
    const ticks: Array<{ x: number; label: string }> = [];
    const n = rows.length;
    const addTick = (idx: number) => {
      if (idx < 0 || idx >= n) return;
      const x = n === 1 ? 0 : (idx / (n - 1)) * 100;
      const year = new Date(rows[idx].dueDate).getFullYear();
      ticks.push({ x, label: String(year) });
    };
    // Mostrar un tick cada 2 años para evitar desbordes en móvil
    addTick(0);
    for (let i = 23; i < n; i += 24) addTick(i);
    if ((n - 1) % 24 !== 23) addTick(n - 1);
    // Deduplicar etiquetas de año consecutivas si coincidieran por redondeos
    const seen = new Set<string>();
    return ticks.filter(t => {
      const key = `${t.label}-${Math.round(t.x * 10) / 10}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  get yAxisMoneyTicks(): number[] {
    const max = this.lineChartMaxY;
    const step = Math.max(1000, Math.ceil(max / 4 / 1000) * 1000);
    const top = step * 4;
    return [top, top - step, top - step * 2, top - step * 3, 0];
  }

  getYFromValue(value: number): number {
    const max = this.yAxisMoneyTicks[0] || 1;
    const h = 40;
    return h - ((Math.max(0, value) / max) * h);
  }

  toPolyline(points: LinePoint[]): string {
    return points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  }

  pointRadius(paid: boolean): number {
    return paid ? 0.7 : 0.45;
  }

  get xAxisStartLabel(): string {
    const first = this.lineChartRows[0];
    return first ? new Date(first.dueDate).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }) : '';
  }

  get xAxisEndLabel(): string {
    const rows = this.lineChartRows;
    const last = rows[rows.length - 1];
    return last ? new Date(last.dueDate).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }) : '';
  }

  get paidBoundaryX(): number | null {
    const rows = this.lineChartRows;
    const paidCount = rows.filter(r => r.paid).length;
    if (paidCount <= 0) return null;
    if (paidCount >= rows.length) return 100;
    return ((paidCount - 1) / Math.max(1, rows.length - 1)) * 100;
  }

  private buildLinePoints(values: number[]): LinePoint[] {
    const rows = this.lineChartRows;
    const maxY = this.lineChartMaxY;
    const w = 100;
    const h = 40;
    const n = values.length;
    if (!n) return [];
    return values.map((v, i) => ({
      x: n === 1 ? 0 : (i / (n - 1)) * w,
      y: h - ((v / maxY) * h),
      paid: !!rows[i]?.paid,
    }));
  }

  getAmortizationSegmentWidth(value: number, total: number): string {
    if (total <= 0 || value <= 0) return '0%';
    return `${(value / total) * 100}%`;
  }

  getAmortizationPercent(value: number, total: number): number {
    if (total <= 0 || value <= 0) return 0;
    return (value / total) * 100;
  }

  saveSettings(): void {
    this.savingSettings = true;
    this.settingsSaveMessage = null;
    this.settingsSaveError = null;
    this.transactionService.updateMortgageSettings({
      principal: +this.principal || 0,
      annual_rate: +this.annualRate || 0,
      term_years: Math.max(1, Math.round(+this.termYears || 1)),
    }).subscribe({
      next: (res) => {
        this.principal = +res.settings.principal || 0;
        this.annualRate = +res.settings.annual_rate || 0;
        this.termYears = +res.settings.term_years || 30;
        this.savingSettings = false;
        this.settingsSaveMessage = 'Parámetros guardados';
        this.editingConditions = false;
      },
      error: (err) => {
        this.savingSettings = false;
        this.settingsSaveError = err?.error?.detail || 'No se pudieron guardar los parámetros';
      }
    });
  }

  setConfirmed(tx: Transaction, confirmed: boolean): void {
    const id = tx.id;
    if (!id) return;
    const current = this.getReceiptState(tx);
    this.saveReceiptState(id, { ...current, confirmed });
  }

  setIncluded(tx: Transaction, included: boolean): void {
    const id = tx.id;
    if (!id) return;
    const current = this.getReceiptState(tx);
    this.saveReceiptState(id, { ...current, included_in_calculation: included });
  }

  openEditConditions(): void {
    this.editingConditions = true;
  }

  openDetectedReceiptsModal(): void {
    this.showDetectedReceiptsModal = true;
  }

  closeDetectedReceiptsModal(): void {
    this.showDetectedReceiptsModal = false;
  }

  getArchivedStatusLabel(tx: Transaction): 'Confirmado' | 'Excluido' {
    return this.isIncluded(tx) ? 'Confirmado' : 'Excluido';
  }

  editArchivedState(tx: Transaction): void {
    // Confirmado -> vuelve a pendiente (sin confirmar)
    if (this.isIncluded(tx) && this.isConfirmed(tx)) {
      this.setConfirmed(tx, false);
      return;
    }
    // Excluido -> vuelve a incluido (pendiente de confirmar)
    if (!this.isIncluded(tx)) {
      this.setIncluded(tx, true);
      this.setConfirmed(tx, false);
    }
  }

  getAbsAmount(tx: Transaction): number {
    return Math.abs(tx.importe || 0);
  }

  private loadTransactions(): void {
    this.loading = true;
    this.error = null;
    this.transactionService.getTransactions({ limit: 5000, offset: 0 }).subscribe({
      next: (res) => {
        this.transactions = Array.isArray(res?.data) ? res.data : [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.detail || 'No se pudieron cargar los movimientos';
        this.loading = false;
      }
    });
  }

  private loadMortgageConfig(): void {
    this.transactionService.getMortgageConfig().subscribe({
      next: (res) => {
        const settings = res?.settings;
        if (settings) {
          this.principal = +settings.principal || 0;
          this.annualRate = +settings.annual_rate || 0;
          this.termYears = +settings.term_years || 30;
        }
        const byTx: Record<number, { confirmed: boolean; included_in_calculation: boolean }> = {};
        for (const row of (res?.receipts || [])) {
          const id = Number(row.transaction_id);
          if (!id) continue;
          byTx[id] = {
            confirmed: !!row.confirmed,
            included_in_calculation: row.included_in_calculation !== false,
          };
        }
        this.receiptStateByTx = byTx;
        this.mortgageConfigResolved = true;
      },
      error: () => {
        // Si falla, mantenemos el panel principal por defecto
        this.mortgageConfigResolved = true;
      }
    });
  }

  private getReceiptState(tx: Transaction): { confirmed: boolean; included_in_calculation: boolean } {
    const id = Number(tx.id);
    if (id && this.receiptStateByTx[id]) {
      return this.receiptStateByTx[id];
    }
    return { confirmed: false, included_in_calculation: true };
  }

  private getMortgageStartDate(): Date {
    const asc = [...this.confirmedIncludedTxs].sort((a, b) => (a.dt_date || '').localeCompare(b.dt_date || ''));
    const first = asc[0];
    const parsed = first?.dt_date ? new Date(first.dt_date) : new Date();
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private saveReceiptState(id: number, state: { confirmed: boolean; included_in_calculation: boolean }): void {
    this.savingReceiptIds[id] = true;
    this.transactionService.updateMortgageReceipt({
      transaction_id: id,
      confirmed: state.confirmed,
      included_in_calculation: state.included_in_calculation,
    }).subscribe({
      next: () => {
        this.receiptStateByTx[id] = state;
        this.savingReceiptIds[id] = false;
      },
      error: () => {
        this.savingReceiptIds[id] = false;
      }
    });
  }
}

