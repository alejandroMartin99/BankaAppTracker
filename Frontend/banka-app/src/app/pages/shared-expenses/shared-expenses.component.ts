import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone, ChangeDetectionStrategy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService, SharedPartnerInfo } from '../../services/transaction.service';
import { Transaction } from '../../models/transaction.model';
import { getTransactionIconInfo } from '../../utils/transaction-icons';
import { PrivacyService } from '../../services/privacy.service';
import { BackendLoaderService } from '../../services/backend-loader.service';

type DatePreset = 'all' | 'month' | '30d' | '3m' | 'year' | 'custom';

interface SubcategorySummary {
  subcategoria: string;
  total: number;
  transactions: Transaction[];
}

interface CategorySummary {
  categoria: string;
  total: number;
  subcategories: SubcategorySummary[];
}

interface MonthSummary {
  monthKey: string;
  label: string;
  total: number;
  totalMine: number;
  totalOther: number;
  totalJoint: number;
  categories: CategorySummary[];
}

interface SubcategoryInsight {
  name: string;
  total: number;
  mine: number;
  other: number;
  joint: number;
  txCount: number;
}

interface SubBreakdown {
  mine: number;
  other: number;
  joint: number;
  total: number;
}

function makeCatKey(monthKey: string, cat: string): string {
  return `${monthKey}::${cat || 'Sin categoría'}`;
}

function makeSubKey(monthKey: string, cat: string, sub: string): string {
  return `${monthKey}::${cat || 'Sin categoría'}|${sub || 'Sin subcategoría'}`;
}

const SHARED_FILTER_STORAGE_KEY = 'banka.sharedExpenses.filterKeys';

function normFilterPart(s: string): string {
  return (s || '').trim().toLowerCase();
}

function filterPairKey(cat: string, sub: string): string {
  return `${normFilterPart(cat)}|${normFilterPart(sub)}`;
}

function filterWholeCategoryKey(cat: string): string {
  return `${normFilterPart(cat)}|*`;
}

function mergeUniqueSortedCategories(fromTx: string[], fromCatalog: string[]): string[] {
  const keyToCanon = new Map<string, string>();
  for (const x of [...fromTx, ...fromCatalog]) {
    const t = (x || '').trim();
    if (!t || isExcludedFilterLabel(t)) continue;
    const k = t.toLowerCase();
    if (!keyToCanon.has(k)) keyToCanon.set(k, t);
  }
  return Array.from(keyToCanon.values()).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

function isExcludedFilterLabel(label: string): boolean {
  const n = normFilterPart(label);
  return n === 'otros' || n === 'otro' || n === 'sin categoría' || n === 'sin subcategoría';
}

@Component({
  selector: 'app-shared-expenses',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  templateUrl: './shared-expenses.component.html',
  styleUrl: './shared-expenses.component.scss',
})
export class SharedExpensesComponent implements OnInit, OnDestroy {
  transactions: Transaction[] = [];
  sharedWithUserName: string | null = null;
  partners: SharedPartnerInfo[] = [];
  partnerAccountsLinked = false;
  jointAccountNames: string[] = [];
  loading = false;
  error: string | null = null;

  fromDate = '';
  toDate = '';
  activePreset: DatePreset | null = 'all';
  customFrom = '';
  customTo = '';
  showCalendar = false;
  showManageAccountsModal = false;
  sharedBalancesEnabled = false;
  savingSharedConsent = false;
  sharedConsentError: string | null = null;
  expandedMonthKey: string | null = null;
  expandedCategoryKey: string | null = null;
  expandedSubcategoryKey: string | null = null;
  selectedChartMonthKey: string | null = null;
  catalogCategories: string[] = [];
  catalogSubByCategory: Record<string, string[]> = {};
  selectedFilterKeys = new Set<string>();
  activeFilterCategory = '';
  private filterSelectionReady = false;
  private destroy$ = new Subject<void>();
  private filteredSummaryCache: Transaction[] = [];
  private linkedAccountNamesCache: string[] = [];
  private monthsSummaryCache: MonthSummary[] = [];
  private subcategoryInsightsCache: SubcategoryInsight[] = [];
  private topSubcategoryNamesCache: string[] = [];
  private monthSubBreakdownCache = new Map<string, SubBreakdown>();
  private monthSubcategoryMaxCache = new Map<string, number>();
  private totalMineCache = 0;
  private totalOtherCache = 0;
  private totalJointCache = 0;
  private totalMineNoConjuntaCache = 0;
  private totalOtherNoConjuntaCache = 0;
  private useStartupLoader = true;

  readonly presets: { id: DatePreset; label: string }[] = [
    { id: 'all', label: 'Histórico' },
    { id: 'month', label: 'Mes en curso' },
    { id: '30d', label: '30 días' },
    { id: '3m', label: '3 meses' },
    { id: 'year', label: 'Año' },
    { id: 'custom', label: 'Personalizado' }
  ];

  constructor(
    private transactionService: TransactionService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    public privacy: PrivacyService,
    private backendLoader: BackendLoaderService,
  ) {}

  ngOnInit() {
    this.loadCategoryCatalog();
    this.applyPreset('all');
    this.transactionService.dataRefresh$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.loadCategoryCatalog();
        this.loadTransactions();
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadTransactions() {
    const withStartupLoader = this.useStartupLoader;
    if (withStartupLoader) this.backendLoader.beginPageLoad();

    this.loading = true;
    this.error = null;
    this.transactionService.getSharedTransactions({
      from_date: this.fromDate || undefined,
      to_date: this.toDate || undefined
    }).subscribe({
      next: (res) => {
        const raw = res?.data;
        const arr = Array.isArray(raw) ? raw : (Array.isArray((raw as any)?.data) ? (raw as any).data : []);
        const mapped = arr.map((t: any) => ({
          id: t.id,
          transaction_id: t.transaction_id,
          dt_date: t.dt_date || t.transaction_date || '',
          importe: typeof t.importe === 'number' ? t.importe : parseFloat(t.importe) || 0,
          saldo: t.saldo != null ? (typeof t.saldo === 'number' ? t.saldo : parseFloat(t.saldo)) : undefined,
          cuenta: t.cuenta || t.account_number,
          descripcion: t.descripcion || t.description || '',
          categoria: (t.categoria ?? t.category ?? t.Categoria ?? '').toString().trim(),
          subcategoria: t.subcategoria ?? t.Subcategoria,
          is_own_account: t.is_own_account === true,
          is_partner_account: t.is_partner_account === true,
          is_joint_account: t.is_joint_account === true
        }));
        this.ngZone.run(() => {
          this.transactions = mapped;
          this.sharedWithUserName = ((res as any)?.shared_with_user_name || '').toString().trim() || null;
          this.partners = Array.isArray((res as any)?.partners) ? (res as any).partners : [];
          this.partnerAccountsLinked = !!(res as any)?.partner_accounts_linked;
          this.jointAccountNames = Array.isArray((res as any)?.joint_account_names)
            ? (res as any).joint_account_names.filter((n: string) => !!n)
            : [];
          this.sharedBalancesEnabled = !!(res as any)?.shared_balances_enabled;
          this.sharedConsentError = null;
          this.ensureFilterSelection();
          this.loading = false;
          this.recomputeDerivedData();
          if (withStartupLoader) {
            this.useStartupLoader = false;
            this.backendLoader.endPageLoad();
          }
          this.cdr.detectChanges();
        });
      },
      error: (err) => {
        this.ngZone.run(() => {
          console.error('[SharedExpenses] error:', err);
          this.error = err.error?.detail || 'Error al cargar. ¿Backend conectado?';
          this.sharedWithUserName = null;
          this.loading = false;
          if (withStartupLoader) {
            this.useStartupLoader = false;
            this.backendLoader.endPageLoad();
          }
          this.cdr.detectChanges();
        });
      }
    });
  }

  applyPreset(preset: DatePreset) {
    if (preset === 'custom') {
      this.showCalendar = true;
      this.customFrom = this.fromDate || this.formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
      this.customTo = this.toDate || this.formatDate(new Date());
      return;
    }
    this.showCalendar = false;
    this.activePreset = preset;
    const now = new Date();
    switch (preset) {
      case 'all':
        this.fromDate = '';
        this.toDate = '';
        break;
      case 'month':
        this.fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        this.toDate = this.formatDate(now);
        break;
      case '30d':
        const d30 = new Date(now);
        d30.setDate(d30.getDate() - 30);
        this.fromDate = this.formatDate(d30);
        this.toDate = this.formatDate(now);
        break;
      case '3m':
        const m3 = new Date(now);
        m3.setMonth(m3.getMonth() - 3);
        this.fromDate = this.formatDate(m3);
        this.toDate = this.formatDate(now);
        break;
      case 'year':
        this.fromDate = `${now.getFullYear()}-01-01`;
        this.toDate = this.formatDate(now);
        break;
    }
    this.loadTransactions();
  }

  applyCustomRange() {
    this.fromDate = this.customFrom;
    this.toDate = this.customTo;
    this.activePreset = 'custom';
    this.showCalendar = false;
    this.loadTransactions();
  }

  closeCalendar() {
    this.showCalendar = false;
  }

  formatDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  formatDisplayDate(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  }
  getIconInfo(t: Transaction) {
    return getTransactionIconInfo(t);
  }

  onIconError(ev: Event) {
    const img = ev.target as HTMLImageElement;
    if (img && !img.src.endsWith('/icons/default.svg')) img.src = '/icons/default.svg';
  }

  /** Etiquetas de categorías/subcategorías incluidas (para chips de resumen). */
  get includedFilterItems(): string[] {
    const items: string[] = [];
    for (const cat of this.filterCategoriesList) {
      if (this.selectedFilterKeys.has(filterWholeCategoryKey(cat))) {
        items.push(cat);
        continue;
      }
      const subs = this.getFilterSubsForCategory(cat).filter((s) => this.isSubFilterSelected(cat, s));
      for (const sub of subs) items.push(sub);
    }
    return items;
  }

  get filterCategoriesList(): string[] {
    const fromTx: string[] = [];
    const seen = new Set<string>();
    for (const t of this.transactions) {
      const c = (t.categoria || '').toString().trim();
      if (!c || isExcludedFilterLabel(c) || seen.has(c.toLowerCase())) continue;
      seen.add(c.toLowerCase());
      fromTx.push(c);
    }
    return mergeUniqueSortedCategories(fromTx, this.catalogCategories);
  }

  get activeFilterSubs(): string[] {
    return this.activeFilterCategory ? this.getFilterSubsForCategory(this.activeFilterCategory) : [];
  }

  isActiveCategoryWholeSelected(): boolean {
    return !!this.activeFilterCategory && this.selectedFilterKeys.has(filterWholeCategoryKey(this.activeFilterCategory));
  }

  onFilterCategoryPick(categoria: string): void {
    this.activeFilterCategory = categoria;
    this.cdr.detectChanges();
  }

  private syncActiveFilterCategory(): void {
    const list = this.filterCategoriesList;
    if (!list.length) {
      this.activeFilterCategory = '';
      return;
    }
    if (this.activeFilterCategory && list.includes(this.activeFilterCategory)) return;
    this.activeFilterCategory =
      list.find((c) => normFilterPart(c) === 'suministros') ||
      list.find((c) => this.isCategoryFilterActive(c)) ||
      list[0]!;
  }

  getFilterSubsForCategory(categoria: string): string[] {
    const key = (categoria || '').trim();
    if (!key) return [];
    const set = new Set<string>();
    const canon = this.findCatalogCategoryKey(key);
    if (canon) {
      for (const s of this.catalogSubByCategory[canon] || []) {
        if (s && !isExcludedFilterLabel(s)) set.add(s);
      }
    }
    for (const t of this.transactions) {
      const c = (t.categoria || '').toString().trim();
      if (c.toLowerCase() !== key.toLowerCase()) continue;
      const s = (t.subcategoria || '').toString().trim();
      if (s && !isExcludedFilterLabel(s)) set.add(s);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }

  isSubFilterSelected(categoria: string, subcategoria: string): boolean {
    return (
      this.selectedFilterKeys.has(filterWholeCategoryKey(categoria)) ||
      this.selectedFilterKeys.has(filterPairKey(categoria, subcategoria))
    );
  }

  isCategoryFilterActive(categoria: string): boolean {
    if (this.selectedFilterKeys.has(filterWholeCategoryKey(categoria))) return true;
    return this.getFilterSubsForCategory(categoria).some((s) => this.isSubFilterSelected(categoria, s));
  }

  toggleWholeCategory(categoria: string): void {
    const wk = filterWholeCategoryKey(categoria);
    const subs = this.getFilterSubsForCategory(categoria);
    if (this.selectedFilterKeys.has(wk) || subs.every((s) => this.isSubFilterSelected(categoria, s))) {
      this.selectedFilterKeys.delete(wk);
      for (const sub of subs) this.selectedFilterKeys.delete(filterPairKey(categoria, sub));
    } else {
      this.selectedFilterKeys.add(wk);
      for (const sub of subs) this.selectedFilterKeys.delete(filterPairKey(categoria, sub));
    }
    this.persistFilterSelection();
    this.recomputeDerivedData();
    this.cdr.detectChanges();
  }

  toggleFilterSub(categoria: string, subcategoria: string): void {
    const wk = filterWholeCategoryKey(categoria);
    const pk = filterPairKey(categoria, subcategoria);
    if (this.selectedFilterKeys.has(wk)) {
      this.selectedFilterKeys.delete(wk);
      for (const sub of this.getFilterSubsForCategory(categoria)) {
        if (sub !== subcategoria) this.selectedFilterKeys.add(filterPairKey(categoria, sub));
      }
    } else if (this.selectedFilterKeys.has(pk)) {
      this.selectedFilterKeys.delete(pk);
    } else {
      this.selectedFilterKeys.add(pk);
      const subs = this.getFilterSubsForCategory(categoria);
      if (subs.length > 0 && subs.every((s) => this.isSubFilterSelected(categoria, s))) {
        for (const sub of subs) this.selectedFilterKeys.delete(filterPairKey(categoria, sub));
        this.selectedFilterKeys.add(wk);
      }
    }
    this.persistFilterSelection();
    this.recomputeDerivedData();
    this.cdr.detectChanges();
  }

  private loadCategoryCatalog(): void {
    this.transactionService.getCategoryCatalog().subscribe({
      next: (res) => {
        this.ngZone.run(() => {
          if (res?.success && Array.isArray(res.categories)) {
            this.catalogCategories = res.categories;
            this.catalogSubByCategory = res.subcategories_by_category || {};
          } else {
            this.catalogCategories = [];
            this.catalogSubByCategory = {};
          }
          this.ensureFilterSelection();
          this.recomputeDerivedData();
          this.cdr.detectChanges();
        });
      },
      error: () => {
        this.ngZone.run(() => {
          this.catalogCategories = [];
          this.catalogSubByCategory = {};
          this.ensureFilterSelection();
          this.recomputeDerivedData();
          this.cdr.detectChanges();
        });
      }
    });
  }

  private findCatalogCategoryKey(cat: string): string | null {
    const c = (cat || '').trim();
    if (!c) return null;
    if (this.catalogSubByCategory[c]) return c;
    const lower = c.toLowerCase();
    for (const k of Object.keys(this.catalogSubByCategory)) {
      if (k.toLowerCase() === lower) return k;
    }
    return null;
  }

  private ensureFilterSelection(): void {
    if (this.filterSelectionReady) return;
    const stored = this.readFilterSelectionFromStorage();
    if (stored.length > 0) {
      this.selectedFilterKeys = new Set(stored);
      this.filterSelectionReady = true;
      return;
    }
    this.applyDefaultFilterSelection();
    this.filterSelectionReady = true;
  }

  private applyDefaultFilterSelection(): void {
    this.selectedFilterKeys.clear();
    for (const cat of this.filterCategoriesList.length ? this.filterCategoriesList : this.catalogCategories) {
      if (normFilterPart(cat) === 'suministros') {
        this.selectedFilterKeys.add(filterWholeCategoryKey(cat));
      }
      for (const sub of this.getFilterSubsForCategory(cat)) {
        if (normFilterPart(sub) === 'gimnasio') {
          this.selectedFilterKeys.add(filterPairKey(cat, sub));
        }
      }
    }
    if (this.selectedFilterKeys.size === 0) {
      for (const cat of this.catalogCategories) {
        if (normFilterPart(cat) === 'suministros') {
          this.selectedFilterKeys.add(filterWholeCategoryKey(cat));
        }
        const canon = this.findCatalogCategoryKey(cat) || cat;
        for (const sub of this.catalogSubByCategory[canon] || []) {
          if (normFilterPart(sub) === 'gimnasio') {
            this.selectedFilterKeys.add(filterPairKey(cat, sub));
          }
        }
      }
    }
    this.persistFilterSelection();
  }

  private readFilterSelectionFromStorage(): string[] {
    try {
      const raw = localStorage.getItem(SHARED_FILTER_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((x) => typeof x === 'string' && !this.isStoredFilterKeyExcluded(x))
        : [];
    } catch {
      return [];
    }
  }

  private persistFilterSelection(): void {
    try {
      localStorage.setItem(SHARED_FILTER_STORAGE_KEY, JSON.stringify(Array.from(this.selectedFilterKeys)));
    } catch {
      /* ignore quota / private mode */
    }
  }

  private isStoredFilterKeyExcluded(key: string): boolean {
    const [cat = '', sub = ''] = key.split('|');
    if (isExcludedFilterLabel(cat)) return true;
    return sub !== '*' && isExcludedFilterLabel(sub);
  }

  private transactionMatchesFilter(t: Transaction): boolean {
    if ((t.importe ?? 0) >= 0) return false;
    if (this.selectedFilterKeys.size === 0) return false;
    const cat = String(t.categoria ?? '').trim();
    const sub = String(t.subcategoria ?? '').trim() || 'Sin subcategoría';
    if (this.selectedFilterKeys.has(filterWholeCategoryKey(cat))) return true;
    return this.selectedFilterKeys.has(filterPairKey(cat, sub));
  }

  /** Nombres de cuentas detectadas de la otra parte en este periodo. */
  get linkedAccountNames(): string[] {
    return this.linkedAccountNamesCache;
  }

  private get filteredForSummary(): Transaction[] {
    return this.filteredSummaryCache;
  }

  get displayedTransactions(): Transaction[] {
    return this.filteredForSummary;
  }

  /** Agrupado por mes, luego categoría y subcategoría */
  get monthsSummary(): MonthSummary[] {
    return this.monthsSummaryCache;
  }

  /** Total que has pagado tú (todos los gastos del filtro) */
  get totalMine(): number {
    return this.totalMineCache;
  }

  /** Total que ha pagado la otra parte (datos reales recibidos del backend). */
  get totalOther(): number {
    return this.totalOtherCache;
  }

  get sharedTotal(): number {
    return this.totalMine + this.totalOther + this.totalJoint;
  }

  /** Total cargado en la cuenta Conjunta (pago de los dos) */
  get totalJoint(): number {
    return this.totalJointCache;
  }

  /** Etiqueta de la pareja vinculada (Conjunta u otro vínculo). */
  get partnerLabel(): string {
    if (this.sharedWithUserName) return this.sharedWithUserName;
    if (this.partners.length > 0) return this.partners[0]!.display_name || 'Tu pareja';
    return 'La otra parte';
  }

  get partnerShortLabel(): string {
    const first = (this.partnerLabel || '').trim().split(/\s+/)[0];
    return first || 'Pareja';
  }

  /** Mitad teórica de gastos en Conjunta (50/50). */
  get jointFairShare(): number {
    return +(this.totalJoint / 2).toFixed(2);
  }

  get jointLabel(): string {
    if (this.jointAccountNames.length === 1) return this.jointAccountNames[0]!;
    if (this.jointAccountNames.length > 1) return this.jointAccountNames.join(', ');
    return 'Cuenta común';
  }

  private isJointAccount(t: Transaction): boolean {
    return t.is_joint_account === true;
  }

  private isMinePersonal(t: Transaction): boolean {
    return !this.isJointAccount(t) && t.is_own_account === true;
  }

  private isPartnerPersonal(t: Transaction): boolean {
    if (this.isJointAccount(t)) return false;
    return t.is_partner_account === true || t.is_own_account === false;
  }

  /** Tuyo excluyendo Conjunta, para el saldo */
  get totalMineNoConjunta(): number {
    return this.totalMineNoConjuntaCache;
  }

  /** Del otro excluyendo Conjunta, para el saldo */
  get totalOtherNoConjunta(): number {
    return this.totalOtherNoConjuntaCache;
  }

  /**
   * Saldo a tu favor (50/50) solo con cuentas no Conjunta.
   * Conjunta = pago de ambos, no cuenta para quién debe a quién.
   * > 0: te deben. < 0: debes. 0: estáis en paz.
   */
  get settlementAmount(): number {
    const mine = this.totalMineNoConjunta;
    const other = this.totalOtherNoConjunta;
    const total = mine + other;
    if (total === 0) return 0;
    const idealPorPersona = total / 2;
    return +(mine - idealPorPersona).toFixed(2);
  }

  private getSubcategoryName(t: Transaction): string {
    const cat = (t.categoria || '').toString().trim() || 'Sin categoría';
    const sub = (t.subcategoria || '').toString().trim();
    const subLabel = sub || 'Sin subcategoría';
    return `${cat} · ${subLabel}`;
  }

  getSubLabelOnly(fullLabel: string): string {
    const i = (fullLabel || '').indexOf(' · ');
    return i >= 0 ? fullLabel.slice(i + 3) : fullLabel;
  }

  /** Ranking de subcategorías con desglose por quién paga. */
  get subcategoryInsights(): SubcategoryInsight[] {
    return this.subcategoryInsightsCache;
  }

  get topSubcategoryInsights(): SubcategoryInsight[] {
    return this.subcategoryInsights.slice(0, 5);
  }

  get topSubcategoryNames(): string[] {
    return this.topSubcategoryNamesCache;
  }

  getMonthSubcategoryMax(monthKey: string): number {
    return this.monthSubcategoryMaxCache.get(monthKey) ?? 0;
  }

  getMonthSubBreakdown(monthKey: string, subName: string): SubBreakdown {
    return this.monthSubBreakdownCache.get(makeSubKey(monthKey, '', subName)) ?? { mine: 0, other: 0, joint: 0, total: 0 };
  }

  /** Últimos meses para gráfica comparativa (cronológico ascendente). */
  get chartMonths(): MonthSummary[] {
    return [...this.monthsSummary].slice(0, 6).reverse();
  }

  /** Máximo valor para escalar barras de la comparativa mensual. */
  get chartMaxValue(): number {
    let max = 0;
    for (const m of this.chartMonths) {
      max = Math.max(max, m.totalMine, m.totalOther, m.totalJoint);
    }
    return max;
  }

  getBarWidth(value: number, maxValue: number): string {
    if (!value || maxValue <= 0) return '0%';
    return `${(value / maxValue) * 100}%`;
  }

  getMonthSettlement(m: MonthSummary): number {
    const total = (m.totalMine || 0) + (m.totalOther || 0);
    if (total === 0) return 0;
    return +((m.totalMine || 0) - total / 2).toFixed(2);
  }

  openMonthChart(monthKey: string): void {
    this.selectedChartMonthKey = this.selectedChartMonthKey === monthKey ? null : monthKey;
  }

  getAccountLabelShort(cuenta?: string): string {
    if (!cuenta) return '';
    return cuenta.length > 10 ? cuenta.slice(0, 9) + '…' : cuenta;
  }

  getAccountLabel(cuenta?: string): string {
    return cuenta || '';
  }

  toggleMonth(monthKey: string) {
    this.expandedMonthKey = this.expandedMonthKey === monthKey ? null : monthKey;
  }

  isMonthExpanded(monthKey: string): boolean {
    return this.expandedMonthKey === monthKey;
  }

  toggleCategory(monthKey: string, categoria: string) {
    const key = makeCatKey(monthKey, categoria);
    this.expandedCategoryKey = this.expandedCategoryKey === key ? null : key;
  }

  toggleSubcategory(monthKey: string, categoria: string, subcategoria: string) {
    const key = makeSubKey(monthKey, categoria, subcategoria);
    this.expandedSubcategoryKey = this.expandedSubcategoryKey === key ? null : key;
  }

  isCategoryExpanded(monthKey: string, categoria: string): boolean {
    return this.expandedCategoryKey === makeCatKey(monthKey, categoria);
  }

  isSubcategoryExpanded(monthKey: string, categoria: string, subcategoria: string): boolean {
    return this.expandedSubcategoryKey === makeSubKey(monthKey, categoria, subcategoria);
  }

  retry() {
    this.loadTransactions();
  }

  private recomputeDerivedData(): void {
    if (!this.filterSelectionReady && this.catalogCategories.length === 0 && this.transactions.length === 0) {
      return;
    }
    if (!this.filterSelectionReady) {
      this.ensureFilterSelection();
    }
    this.filteredSummaryCache = this.transactions.filter((t) => this.transactionMatchesFilter(t));

    const names = new Set<string>();
    const byMonth = new Map<string, Transaction[]>();
    const bySub = new Map<string, SubcategoryInsight>();
    this.monthSubBreakdownCache.clear();
    this.monthSubcategoryMaxCache.clear();
    this.totalMineCache = 0;
    this.totalOtherCache = 0;
    this.totalJointCache = 0;
    this.totalMineNoConjuntaCache = 0;
    this.totalOtherNoConjuntaCache = 0;

    for (const t of this.filteredSummaryCache) {
      const n = (t.cuenta || '').toString().trim();
      if (this.isPartnerPersonal(t) && n) names.add(n);
      const d = new Date(t.dt_date || '');
      if (isNaN(d.getTime())) continue;
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth.has(mk)) byMonth.set(mk, []);
      byMonth.get(mk)!.push(t);

      const subName = this.getSubcategoryName(t);
      if (!bySub.has(subName)) bySub.set(subName, { name: subName, total: 0, mine: 0, other: 0, joint: 0, txCount: 0 });
      const row = bySub.get(subName)!;
      const amount = Math.abs(t.importe ?? 0);
      row.total += amount;
      row.txCount += 1;
      if (this.isJointAccount(t)) {
        row.joint += amount;
        this.totalJointCache += amount;
      } else if (this.isMinePersonal(t)) {
        row.mine += amount;
        this.totalMineCache += amount;
        this.totalMineNoConjuntaCache += amount;
      } else if (this.isPartnerPersonal(t)) {
        row.other += amount;
        this.totalOtherCache += amount;
        this.totalOtherNoConjuntaCache += amount;
      }
      const bKey = makeSubKey(mk, '', subName);
      const b = this.monthSubBreakdownCache.get(bKey) ?? { mine: 0, other: 0, joint: 0, total: 0 };
      if (this.isJointAccount(t)) b.joint += amount;
      else if (this.isMinePersonal(t)) b.mine += amount;
      else if (this.isPartnerPersonal(t)) b.other += amount;
      b.total = b.mine + b.other + b.joint;
      this.monthSubBreakdownCache.set(bKey, b);
    }

    this.linkedAccountNamesCache = Array.from(names).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    this.subcategoryInsightsCache = Array.from(bySub.values()).sort((a, b) => b.total - a.total);
    const globalTop = this.subcategoryInsightsCache.slice(0, 5).map(x => x.name);
    const otherTop = [...this.subcategoryInsightsCache].filter(x => x.other > 0).sort((a, b) => b.other - a.other).slice(0, 3).map(x => x.name);
    this.topSubcategoryNamesCache = Array.from(new Set([...globalTop, ...otherTop])).slice(0, 7);

    for (const mk of byMonth.keys()) {
      let max = 0;
      for (const sub of this.topSubcategoryNamesCache) {
        const total = this.monthSubBreakdownCache.get(makeSubKey(mk, '', sub))?.total ?? 0;
        if (total > max) max = total;
      }
      this.monthSubcategoryMaxCache.set(mk, max);
    }

    const months: MonthSummary[] = Array.from(byMonth.entries()).map(([monthKey, txs]) => {
      const byCat = new Map<string, Map<string, Transaction[]>>();
      let totalMine = 0; let totalOther = 0; let totalJoint = 0;
      for (const t of txs) {
        const cat = t.categoria || 'Sin categoría';
        const sub = t.subcategoria || 'Sin subcategoría';
        if (!byCat.has(cat)) byCat.set(cat, new Map());
        const subMap = byCat.get(cat)!;
        if (!subMap.has(sub)) subMap.set(sub, []);
        subMap.get(sub)!.push(t);
        const amount = Math.abs(t.importe ?? 0);
        if (this.isJointAccount(t)) totalJoint += amount;
        else if (this.isMinePersonal(t)) totalMine += amount;
        else if (this.isPartnerPersonal(t)) totalOther += amount;
      }
      const categories: CategorySummary[] = Array.from(byCat.entries()).map(([categoria, subMap]) => {
        const subcategories: SubcategorySummary[] = Array.from(subMap.entries()).map(([subcategoria, transactions]) => ({
          subcategoria,
          total: transactions.reduce((s, tx) => s + (tx.importe || 0), 0),
          transactions: transactions.sort((a, b) => (b.dt_date || '').localeCompare(a.dt_date || ''))
        }));
        return { categoria, total: subcategories.reduce((s, sc) => s + sc.total, 0), subcategories: subcategories.sort((a, b) => a.total - b.total) };
      }).sort((a, b) => a.total - b.total);
      const [y, m] = monthKey.split('-').map(Number);
      const label = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
      const total = categories.reduce((s, c) => s + c.total, 0);
      return { monthKey, label, total, totalMine, totalOther, totalJoint, categories };
    });
    this.monthsSummaryCache = months.sort((a, b) => b.monthKey.localeCompare(a.monthKey));
    this.syncActiveFilterCategory();
  }

  openManageAccountsModal(): void {
    this.sharedConsentError = null;
    this.showManageAccountsModal = true;
  }

  closeManageAccountsModal(): void {
    this.showManageAccountsModal = false;
  }

  saveSharedConsent(enabled: boolean): void {
    this.savingSharedConsent = true;
    this.sharedConsentError = null;
    this.transactionService.updateSharedConsent(enabled).subscribe({
      next: (res) => {
        this.sharedBalancesEnabled = !!res?.shared_balances_enabled;
        this.savingSharedConsent = false;
        this.closeManageAccountsModal();
        this.loadTransactions();
      },
      error: (err) => {
        this.sharedConsentError = err?.error?.detail || 'No se pudo guardar la vinculación';
        this.savingSharedConsent = false;
      }
    });
  }
}
