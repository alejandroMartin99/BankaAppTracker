import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { BackendLoaderService } from '../../services/backend-loader.service';
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

interface SimulationPoint {
  x: number;
  y: number;
}

interface SimulationScenario {
  remainingCurve: number[];
  interestPaidCurve: number[];
  paidAccumulatedCurve: number[];
  totalInterest: number;
  totalPaid: number;
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
  showAmortizationHelpModal = false;
  extraAnnualQuotaUnits = 1;
  simulationChartMode: 'capital' | 'interest' = 'capital';
  investmentAnnualReturn = 6;
  mortgageConfigResolved = false;
  private simulationScenarioCache: Record<string, SimulationScenario> = {};
  private investmentFundCurveCache: { key: string; value: number[] } | null = null;
  private investmentFundNetCurveCache: { key: string; value: number[] } | null = null;
  private initialLoadsPending = 0;

  constructor(
    private transactionService: TransactionService,
    private backendLoader: BackendLoaderService,
    public privacy: PrivacyService
  ) {}

  ngOnInit(): void {
    this.backendLoader.beginMinimalLoad();
    this.initialLoadsPending = 2;
    this.loadMortgageConfig();
    this.loadTransactions();
  }

  private onInitialLoadDone(): void {
    if (this.initialLoadsPending <= 0) return;
    this.initialLoadsPending--;
    if (this.initialLoadsPending === 0) {
      this.backendLoader.endMinimalLoad();
    }
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

  get parametersSaved(): boolean {
    return this.principal > 0 && this.annualRate > 0 && this.termYears > 0;
  }

  get showMainSummaryBlock(): boolean {
    return this.parametersSaved && !this.editingConditions;
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

  get totalPaidPrincipal(): number {
    return this.amortizationSchedule
      .filter((r) => r.paid)
      .reduce((sum, r) => sum + r.principal, 0);
  }

  get totalPaidInterest(): number {
    return this.amortizationSchedule
      .filter((r) => r.paid)
      .reduce((sum, r) => sum + r.interest, 0);
  }

  get totalPaidAmount(): number {
    return this.totalPaidPrincipal + this.totalPaidInterest;
  }

  get paidPrincipalPct(): number {
    const total = this.totalPaidAmount;
    if (total <= 0) return 0;
    return (this.totalPaidPrincipal / total) * 100;
  }

  get paidInterestPct(): number {
    const total = this.totalPaidAmount;
    if (total <= 0) return 0;
    return (this.totalPaidInterest / total) * 100;
  }

  get totalMortgageCapital(): number {
    return Math.max(0, this.principal || 0);
  }

  get totalMortgageInterest(): number {
    const total = this.amortizationSchedule.reduce((sum, r) => sum + r.interest, 0);
    return Math.max(0, total);
  }

  get totalMortgageAmount(): number {
    return this.totalMortgageCapital + this.totalMortgageInterest;
  }

  get totalMortgageCapitalPct(): number {
    const total = this.totalMortgageAmount;
    if (total <= 0) return 0;
    return (this.totalMortgageCapital / total) * 100;
  }

  get totalMortgageInterestPct(): number {
    const total = this.totalMortgageAmount;
    if (total <= 0) return 0;
    return (this.totalMortgageInterest / total) * 100;
  }

  get simulationMonthlyExtra(): number {
    const units = Math.max(0, +this.extraAnnualQuotaUnits || 0);
    const monthlyQuota = this.monthlyInstallment;
    if (monthlyQuota <= 0) return 0;
    return (monthlyQuota * units) / 12;
  }

  get baseRemainingCurve(): number[] {
    return this.baseScenario.remainingCurve;
  }

  get extraRemainingCurve(): number[] {
    return this.extraScenario.remainingCurve;
  }

  get baseInterestPaidCurve(): number[] {
    return this.baseScenario.interestPaidCurve;
  }

  get extraInterestPaidCurve(): number[] {
    return this.extraScenario.interestPaidCurve;
  }

  get simulationMaxMonths(): number {
    return Math.max(this.baseRemainingCurve.length, this.extraRemainingCurve.length, 1);
  }

  get simulationMaxY(): number {
    const maxBase = this.baseRemainingCurve.reduce((m, v) => Math.max(m, v), 0);
    const maxExtra = this.extraRemainingCurve.reduce((m, v) => Math.max(m, v), 0);
    const max = Math.max(maxBase, maxExtra);
    return max > 0 ? max : 1;
  }

  get simulationBasePoints(): SimulationPoint[] {
    return this.buildSimulationPoints(this.baseRemainingCurve);
  }

  get simulationExtraPoints(): SimulationPoint[] {
    return this.buildSimulationPoints(this.extraRemainingCurve);
  }

  get simulationInterestMaxY(): number {
    const maxBase = this.baseInterestPaidCurve.reduce((m, v) => Math.max(m, v), 0);
    const maxExtra = this.extraInterestPaidCurve.reduce((m, v) => Math.max(m, v), 0);
    const max = Math.max(maxBase, maxExtra);
    return max > 0 ? max : 1;
  }

  get simulationInterestBasePoints(): SimulationPoint[] {
    return this.buildSimulationPoints(this.baseInterestPaidCurve, this.simulationInterestMaxY);
  }

  get simulationInterestExtraPoints(): SimulationPoint[] {
    return this.buildSimulationPoints(this.extraInterestPaidCurve, this.simulationInterestMaxY);
  }

  get simulationBasePayoffMonths(): number {
    return this.baseRemainingCurve.length > 0 ? this.baseRemainingCurve.length - 1 : 0;
  }

  get simulationExtraPayoffMonths(): number {
    return this.extraRemainingCurve.length > 0 ? this.extraRemainingCurve.length - 1 : 0;
  }

  get simulationSavedMonths(): number {
    return Math.max(0, this.simulationBasePayoffMonths - this.simulationExtraPayoffMonths);
  }

  get simulationBaseTotalInterest(): number {
    return this.baseScenario.totalInterest;
  }

  get simulationExtraTotalInterest(): number {
    return this.extraScenario.totalInterest;
  }

  get simulationSavedInterest(): number {
    return Math.max(0, this.simulationBaseTotalInterest - this.simulationExtraTotalInterest);
  }

  get simulationBaseTotalPaid(): number {
    return this.baseScenario.totalPaid;
  }

  get simulationExtraTotalPaid(): number {
    return this.extraScenario.totalPaid;
  }

  get simulationSavedTotalPaid(): number {
    return Math.max(0, this.simulationBaseTotalPaid - this.simulationExtraTotalPaid);
  }

  get simulationSavedInterestPct(): number {
    if (this.simulationBaseTotalInterest <= 0) return 0;
    return (this.simulationSavedInterest / this.simulationBaseTotalInterest) * 100;
  }

  get simulationSavedTotalPaidPct(): number {
    if (this.simulationBaseTotalPaid <= 0) return 0;
    return (this.simulationSavedTotalPaid / this.simulationBaseTotalPaid) * 100;
  }

  get simulationExtraVsBasePct(): number {
    if (this.simulationBaseTotalPaid <= 0) return 0;
    return ((this.simulationExtraTotalPaid - this.simulationBaseTotalPaid) / this.simulationBaseTotalPaid) * 100;
  }

  get simulationExtraDiffVsBase(): number {
    return this.simulationExtraTotalPaid - this.simulationBaseTotalPaid;
  }

  get simulationBaseInterestPctOfPaid(): number {
    if (this.simulationBaseTotalPaid <= 0) return 0;
    return (this.simulationBaseTotalInterest / this.simulationBaseTotalPaid) * 100;
  }

  get simulationExtraInterestVsBasePct(): number {
    if (this.simulationBaseTotalInterest <= 0) return 0;
    return ((this.simulationExtraTotalInterest - this.simulationBaseTotalInterest) / this.simulationBaseTotalInterest) * 100;
  }

  get simulationYAxisTicks(): number[] {
    return this.buildMoneyTicks(this.simulationMaxY);
  }

  get simulationInterestYAxisTicks(): number[] {
    return this.buildMoneyTicks(this.simulationInterestMaxY);
  }

  get investmentMonthlyReturn(): number {
    return Math.max(0, (+this.investmentAnnualReturn || 0) / 100 / 12);
  }

  get investmentFundCurve(): number[] {
    const cacheKey = [
      this.simulationBasePayoffMonths,
      this.simulationMonthlyExtra.toFixed(6),
      this.investmentMonthlyReturn.toFixed(8),
    ].join('|');
    if (this.investmentFundCurveCache?.key === cacheKey) return this.investmentFundCurveCache.value;

    const months = Math.max(1, this.simulationBasePayoffMonths);
    const contribution = Math.max(0, this.simulationMonthlyExtra);
    const monthlyReturn = this.investmentMonthlyReturn;
    let fund = 0;
    const out: number[] = [0];
    for (let i = 1; i <= months; i++) {
      fund = (fund * (1 + monthlyReturn)) + contribution;
      out.push(fund);
    }
    this.investmentFundCurveCache = { key: cacheKey, value: out };
    return out;
  }

  get investmentFundNetCurve(): number[] {
    const cacheKey = [
      this.simulationMonthlyExtra.toFixed(6),
      this.investmentMonthlyReturn.toFixed(8),
      this.baseRemainingCurve.length,
      this.baseRemainingCurve[0] || 0,
      this.baseRemainingCurve[this.baseRemainingCurve.length - 1] || 0,
    ].join('|');
    if (this.investmentFundNetCurveCache?.key === cacheKey) return this.investmentFundNetCurveCache.value;

    const grossCurve = this.investmentFundCurve;
    const contribution = Math.max(0, this.simulationMonthlyExtra);
    const out: number[] = [];
    for (let i = 0; i < grossCurve.length; i++) {
      const gross = Math.max(0, grossCurve[i] || 0);
      const contributed = contribution * Math.max(0, i);
      const gain = Math.max(0, gross - contributed);
      const gainRatio = gross > 0 ? Math.max(0, Math.min(1, gain / gross)) : 0;
      out.push(this.getNetFromWithdrawal(gross, gainRatio));
    }
    this.investmentFundNetCurveCache = { key: cacheKey, value: out };
    return out;
  }

  get investmentBreakEvenMonth(): number | null {
    const remaining = this.baseRemainingCurve;
    const fund = this.investmentFundNetCurve;
    const n = Math.min(remaining.length, fund.length);
    for (let i = 0; i < n; i++) {
      if (fund[i] >= remaining[i]) return i;
    }
    return null;
  }

  get simulationFundMonths(): number {
    const m = this.investmentBreakEvenMonth;
    return m === null ? this.simulationBasePayoffMonths : m;
  }

  get simulationFundSavedMonths(): number {
    return Math.max(0, this.simulationBasePayoffMonths - this.simulationFundMonths);
  }

  get fundCancelMonth(): number {
    return this.simulationFundMonths;
  }

  get fundPaidInstallmentsToCancel(): number {
    return this.getCurveValueAtMonth(this.baseScenario.paidAccumulatedCurve, this.fundCancelMonth);
  }

  get fundInterestPaidToCancel(): number {
    return this.getCurveValueAtMonth(this.baseScenario.interestPaidCurve, this.fundCancelMonth);
  }

  get fundPrincipalPaidByInstallments(): number {
    return Math.max(0, this.fundPaidInstallmentsToCancel - this.fundInterestPaidToCancel);
  }

  get fundInstallmentsByQuota(): number {
    return Math.max(0, this.fundCancelMonth) * Math.max(0, this.monthlyInstallment);
  }

  get fundCancellationAmount(): number {
    return this.getCurveValueAtMonth(this.baseRemainingCurve, this.fundCancelMonth);
  }

  get fundContributionTotal(): number {
    return Math.max(0, this.simulationMonthlyExtra) * Math.max(0, this.fundCancelMonth);
  }

  get fundGrossFinal(): number {
    return this.getCurveValueAtMonth(this.investmentFundCurve, this.fundCancelMonth);
  }

  get fundNetFinal(): number {
    return this.getCurveValueAtMonth(this.investmentFundNetCurve, this.fundCancelMonth);
  }

  get fundGrossGenerated(): number {
    return Math.max(0, this.fundGrossFinal - this.fundContributionTotal);
  }

  get fundNetGenerated(): number {
    return Math.max(0, this.fundNetFinal - this.fundContributionTotal);
  }

  get totalPaidFundPlusMortgage(): number {
    // En Sim 2 se pagan cuotas base hasta cancelar + cancelación final con fondo.
    return this.fundPaidInstallmentsToCancel + this.fundCancellationAmount;
  }

  get totalRealPaidFundScenario(): number {
    // Dinero realmente puesto por el usuario en Sim 2:
    // cuotas pagadas hasta cancelar + capital aportado al fondo (sin contar rendimientos).
    return this.fundPaidInstallmentsToCancel + this.fundContributionTotal;
  }

  get totalInterestFundScenario(): number {
    // Interés pagado hasta el momento de cancelación.
    return this.fundInterestPaidToCancel;
  }

  get totalPaidFundVsBasePct(): number {
    if (this.simulationBaseTotalPaid <= 0) return 0;
    return ((this.totalPaidFundPlusMortgage - this.simulationBaseTotalPaid) / this.simulationBaseTotalPaid) * 100;
  }

  get totalPaidFundVsSim1Pct(): number {
    if (this.simulationExtraTotalPaid <= 0) return 0;
    return ((this.totalPaidFundPlusMortgage - this.simulationExtraTotalPaid) / this.simulationExtraTotalPaid) * 100;
  }

  get totalRealPaidFundVsBasePct(): number {
    if (this.simulationBaseTotalPaid <= 0) return 0;
    return ((this.totalRealPaidFundScenario - this.simulationBaseTotalPaid) / this.simulationBaseTotalPaid) * 100;
  }

  get totalRealPaidFundVsSim1Pct(): number {
    if (this.simulationExtraTotalPaid <= 0) return 0;
    return ((this.totalRealPaidFundScenario - this.simulationExtraTotalPaid) / this.simulationExtraTotalPaid) * 100;
  }

  get totalRealPaidFundDiffVsBase(): number {
    return this.totalRealPaidFundScenario - this.simulationBaseTotalPaid;
  }

  get totalRealPaidFundDiffVsSim1(): number {
    return this.totalRealPaidFundScenario - this.simulationExtraTotalPaid;
  }

  get totalInterestFundVsBasePct(): number {
    if (this.simulationBaseTotalInterest <= 0) return 0;
    return ((this.totalInterestFundScenario - this.simulationBaseTotalInterest) / this.simulationBaseTotalInterest) * 100;
  }

  get totalInterestFundVsSim1Pct(): number {
    if (this.simulationExtraTotalInterest <= 0) return 0;
    return ((this.totalInterestFundScenario - this.simulationExtraTotalInterest) / this.simulationExtraTotalInterest) * 100;
  }

  get investmentBreakEvenYearLabel(): string {
    const m = this.investmentBreakEvenMonth;
    if (m === null) return 'No alcanzado en el plazo actual';
    const y = Math.floor(m / 12);
    const rem = m % 12;
    return `${y}a ${rem}m`;
  }

  get investmentBreakEvenFund(): number {
    const m = this.investmentBreakEvenMonth;
    if (m === null) return 0;
    return this.investmentFundNetCurve[m] || 0;
  }

  get investmentBreakEvenCapital(): number {
    const m = this.investmentBreakEvenMonth;
    if (m === null) return 0;
    return this.baseRemainingCurve[m] || 0;
  }

  get investmentMaxY(): number {
    const maxRemaining = this.baseRemainingCurve.reduce((m, v) => Math.max(m, v), 0);
    const maxFund = this.investmentFundCurve.reduce((m, v) => Math.max(m, v), 0);
    const maxFundNet = this.investmentFundNetCurve.reduce((m, v) => Math.max(m, v), 0);
    const max = Math.max(maxRemaining, maxFund, maxFundNet);
    return max > 0 ? max : 1;
  }

  get investmentYAxisTicks(): number[] {
    return this.buildMoneyTicks(this.investmentMaxY);
  }

  get investmentBasePoints(): SimulationPoint[] {
    const totalMonths = Math.max(1, this.baseRemainingCurve.length - 1);
    return this.buildSimulationPoints(this.baseRemainingCurve, this.investmentMaxY, totalMonths);
  }

  get investmentFundPoints(): SimulationPoint[] {
    const totalMonths = Math.max(1, this.baseRemainingCurve.length - 1);
    const cut = this.investmentBreakEvenMonth;
    const curve = cut === null ? this.investmentFundCurve : this.investmentFundCurve.slice(0, cut + 1);
    return this.buildSimulationPoints(curve, this.investmentMaxY, totalMonths);
  }

  get investmentFundNetPoints(): SimulationPoint[] {
    const totalMonths = Math.max(1, this.baseRemainingCurve.length - 1);
    const cut = this.investmentBreakEvenMonth;
    const curve = cut === null ? this.investmentFundNetCurve : this.investmentFundNetCurve.slice(0, cut + 1);
    return this.buildSimulationPoints(curve, this.investmentMaxY, totalMonths);
  }

  get investmentEstimatedTaxPct(): number {
    const grossFund = Math.max(0, this.fundGrossFinal);
    if (grossFund <= 0) return 0;
    const contribution = Math.max(0, this.fundContributionTotal);
    const gain = Math.max(0, grossFund - contribution);
    if (gain <= 0) return 0;
    const gainRatio = grossFund > 0 ? Math.max(0, Math.min(1, gain / grossFund)) : 0;
    const tax = this.getTaxForWithdrawal(grossFund, gainRatio);
    return (tax / gain) * 100;
  }

  get investmentEstimatedTaxTotal(): number {
    const grossFund = Math.max(0, this.fundGrossFinal);
    if (grossFund <= 0) return 0;
    const contribution = Math.max(0, this.fundContributionTotal);
    const gain = Math.max(0, grossFund - contribution);
    const gainRatio = grossFund > 0 ? Math.max(0, Math.min(1, gain / grossFund)) : 0;
    return this.getTaxForWithdrawal(grossFund, gainRatio);
  }

  get investmentBasePaidAtBreakEven(): number {
    const m = this.investmentBreakEvenMonth;
    if (m === null) return this.simulationBaseTotalPaid;
    return this.getCurveValueAtMonth(this.baseScenario.paidAccumulatedCurve, m);
  }

  get investmentSim1PaidAtBreakEven(): number {
    const m = this.investmentBreakEvenMonth;
    if (m === null) return this.simulationExtraTotalPaid;
    return this.getCurveValueAtMonth(this.extraScenario.paidAccumulatedCurve, m);
  }

  get investmentSim1VsBaseAtBreakEvenPct(): number {
    const base = this.investmentBasePaidAtBreakEven;
    if (base <= 0) return 0;
    return ((this.investmentSim1PaidAtBreakEven - base) / base) * 100;
  }

  getInvestmentYFromValue(value: number): number {
    const max = this.investmentYAxisTicks[0] || 1;
    const h = 40;
    return h - ((Math.max(0, value) / max) * h);
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

  getSimulationYFromValue(value: number): number {
    const max = this.simulationYAxisTicks[0] || 1;
    const h = 40;
    return h - ((Math.max(0, value) / max) * h);
  }

  getSimulationInterestYFromValue(value: number): number {
    const max = this.simulationInterestYAxisTicks[0] || 1;
    const h = 40;
    return h - ((Math.max(0, value) / max) * h);
  }

  toPolyline(points: LinePoint[]): string {
    return points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  }

  toSimulationPolyline(points: SimulationPoint[]): string {
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

  private get baseScenario(): SimulationScenario {
    return this.getSimulationScenarioCached(0);
  }

  private get extraScenario(): SimulationScenario {
    return this.getSimulationScenarioCached(this.simulationMonthlyExtra);
  }

  private simulateScenario(extraMonthly: number): SimulationScenario {
    const payment = this.monthlyInstallment;
    const r = this.monthlyRate;
    const remaining0 = this.remainingPrincipal;
    const maxMonths = Math.max(1, this.remainingInstallments + 360); // margen de seguridad
    if (payment <= 0 || remaining0 <= 0) {
      return { remainingCurve: [0], interestPaidCurve: [0], paidAccumulatedCurve: [0], totalInterest: 0, totalPaid: 0 };
    }

    let remaining = remaining0;
    let cumulativeInterest = 0;
    let totalPaid = 0;
    const remainingOut: number[] = [remaining0];
    const interestPaidOut: number[] = [0];
    const paidAccumulatedOut: number[] = [0];
    for (let i = 0; i < maxMonths; i++) {
      const interest = r > 0 ? remaining * r : 0;
      const principalPart = Math.max(0, payment + Math.max(0, extraMonthly) - interest);
      if (principalPart <= 0) {
        // amortización imposible: evitar bucle infinito
        break;
      }
      const paidThisMonth = Math.min(remaining + interest, payment + Math.max(0, extraMonthly));
      remaining = Math.max(0, remaining - principalPart);
      cumulativeInterest += interest;
      totalPaid += paidThisMonth;
      remainingOut.push(remaining);
      interestPaidOut.push(cumulativeInterest);
      paidAccumulatedOut.push(totalPaid);
      if (remaining <= 0.005) {
        remainingOut[remainingOut.length - 1] = 0;
        break;
      }
    }
    return {
      remainingCurve: remainingOut,
      interestPaidCurve: interestPaidOut,
      paidAccumulatedCurve: paidAccumulatedOut,
      totalInterest: cumulativeInterest,
      totalPaid,
    };
  }

  private getCurveValueAtMonth(curve: number[], month: number): number {
    if (!curve.length) return 0;
    const idx = Math.max(0, Math.min(month, curve.length - 1));
    return curve[idx] || 0;
  }

  private getSimulationScenarioCached(extraMonthly: number): SimulationScenario {
    const key = [
      Math.max(0, this.remainingPrincipal).toFixed(6),
      Math.max(0, this.monthlyInstallment).toFixed(6),
      Math.max(0, this.monthlyRate).toFixed(8),
      Math.max(1, this.remainingInstallments),
      Math.max(0, extraMonthly).toFixed(6),
    ].join('|');
    const cached = this.simulationScenarioCache[key];
    if (cached) return cached;
    const scenario = this.simulateScenario(extraMonthly);
    this.simulationScenarioCache = { [key]: scenario };
    return scenario;
  }

  private getTaxForWithdrawal(grossWithdrawal: number, gainRatio: number): number {
    const gross = Math.max(0, grossWithdrawal);
    const taxableGain = gross * Math.max(0, Math.min(1, gainRatio));
    return this.calculateSpanishSavingsTax(taxableGain);
  }

  private getNetFromWithdrawal(grossWithdrawal: number, gainRatio: number): number {
    const gross = Math.max(0, grossWithdrawal);
    const tax = this.getTaxForWithdrawal(gross, gainRatio);
    return Math.max(0, gross - tax);
  }

  private getRequiredGrossForTargetNet(targetNet: number, gainRatio: number, grossCap: number): number | null {
    const target = Math.max(0, targetNet);
    const cap = Math.max(0, grossCap);
    if (target <= 0) return 0;
    const netAtCap = this.getNetFromWithdrawal(cap, gainRatio);
    if (netAtCap + 0.005 < target) return null;
    let lo = 0;
    let hi = cap;
    for (let i = 0; i < 36; i++) {
      const mid = (lo + hi) / 2;
      const netMid = this.getNetFromWithdrawal(mid, gainRatio);
      if (netMid >= target) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  private calculateSpanishSavingsTax(taxableBase: number): number {
    // Tramos de ahorro en Espana (ganancias patrimoniales en reembolso de fondos).
    let remaining = Math.max(0, taxableBase);
    let tax = 0;
    const brackets: Array<{ cap: number; rate: number }> = [
      { cap: 6000, rate: 0.19 },
      { cap: 50000, rate: 0.21 },   // hasta 50.000 acumulado
      { cap: 200000, rate: 0.23 },  // hasta 200.000 acumulado
      { cap: 300000, rate: 0.27 },  // hasta 300.000 acumulado
      { cap: Infinity, rate: 0.28 },
    ];
    let prevCap = 0;
    for (const b of brackets) {
      if (remaining <= 0) break;
      const sliceCap = b.cap === Infinity ? remaining : Math.max(0, b.cap - prevCap);
      const taxedSlice = Math.min(remaining, sliceCap);
      tax += taxedSlice * b.rate;
      remaining -= taxedSlice;
      prevCap = b.cap;
    }
    return tax;
  }

  private buildSimulationPoints(values: number[], maxYInput?: number, totalMonthsInput?: number): SimulationPoint[] {
    const n = values.length;
    const w = 100;
    const h = 40;
    const maxY = maxYInput && maxYInput > 0 ? maxYInput : this.simulationMaxY;
    const totalMonths = Math.max(1, totalMonthsInput ?? (this.simulationMaxMonths - 1));
    if (!n) return [];
    return values.map((v, i) => ({
      // Eje X común para todos los escenarios (base vs extra)
      x: (i / totalMonths) * w,
      y: h - ((Math.max(0, v) / maxY) * h),
    }));
  }

  private buildMoneyTicks(maxValue: number): number[] {
    const safe = maxValue > 0 ? maxValue : 1;
    const step = Math.max(1000, Math.ceil(safe / 4 / 1000) * 1000);
    const top = step * 4;
    return [top, top - step, top - step * 2, top - step * 3, 0];
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

  openAmortizationHelpModal(): void {
    this.showAmortizationHelpModal = true;
  }

  closeAmortizationHelpModal(): void {
    this.showAmortizationHelpModal = false;
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
    if (!this.transactionService.hasTransactionsCache()) {
      this.loading = true;
    }
    this.error = null;
    this.transactionService.getTransactions().subscribe({
      next: (res) => {
        this.transactions = Array.isArray(res?.data) ? res.data : [];
        this.loading = false;
        this.onInitialLoadDone();
      },
      error: (err) => {
        this.error = err?.error?.detail || 'No se pudieron cargar los movimientos';
        this.loading = false;
        this.onInitialLoadDone();
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
        this.onInitialLoadDone();
      },
      error: () => {
        this.mortgageConfigResolved = true;
        this.onInitialLoadDone();
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

