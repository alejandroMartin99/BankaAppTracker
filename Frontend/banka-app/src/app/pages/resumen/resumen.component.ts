import { Component, OnInit, OnDestroy } from '@angular/core';
import { trigger, transition, style, animate } from '@angular/animations';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { switchMap, takeUntil } from 'rxjs/operators';
import { TransactionService } from '../../services/transaction.service';
import { Transaction, Account } from '../../models/transaction.model';
import { PrivacyService } from '../../services/privacy.service';

type DatePreset = 'month' | '30d' | '3m' | 'year' | 'custom';

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

function makeSubKey(cat: string, sub: string): string {
  return `${cat || 'Sin categoría'}|${sub || 'Sin subcategoría'}`;
}

const ADD_NEW_SUBCATEGORY = '__ADD_NEW__';

function mergeUniqueSortedCategories(fromTx: string[], fromCatalog: string[]): string[] {
  const keyToCanon = new Map<string, string>();
  for (const x of [...fromTx, ...fromCatalog]) {
    const t = (x || '').trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (!keyToCanon.has(k)) keyToCanon.set(k, t);
  }
  return Array.from(keyToCanon.values()).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

@Component({
  selector: 'app-resumen',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './resumen.component.html',
  styleUrl: './resumen.component.scss',
  animations: [
    trigger('loaderOverlay', [
      transition(':enter', [style({ opacity: 0 }), animate('200ms ease-out', style({ opacity: 1 }))]),
      transition(':leave', [animate('180ms ease-in', style({ opacity: 0 }))])
    ])
  ]
})
export class ResumenComponent implements OnInit, OnDestroy {
  transactions: Transaction[] = [];
  loading = false;
  showLoader = false;
  error: string | null = null;

  fromDate = '';
  toDate = '';
  activePreset: DatePreset | null = 'month';
  customFrom = '';
  customTo = '';
  showCalendar = false;
  expandedCategory: string | null = null;
  expandedSubcategoryKey: string | null = null;
  expandedIncomeCategory: string | null = null;
  expandedIncomeSubcategoryKey: string | null = null;
  /** Cuentas seleccionadas para filtrar (multi-select). Vacío = todas. */
  selectedAccounts: string[] = [];

  /** Modal editar (fecha, descripción, categoría, subcategoría — como Ajustes). */
  editModalTx: Transaction | null = null;
  editDraftDateTime = '';
  editDraftDesc = '';
  editDraftCategoria = '';
  editDraftSubcategoria = '';
  editDraftSubcategoriaCustom = '';
  readonly addNewSubcategoryValue = ADD_NEW_SUBCATEGORY;
  savingEdit = false;
  deletingEdit = false;
  editError: string | null = null;

  /** Catálogo backend (desplegables categoría/sub). */
  catalogCategories: string[] = [];
  catalogSubByCategory: Record<string, string[]> = {};

  private destroy$ = new Subject<void>();

  accounts: Account[] = [];
  accountFilters: { id: string; label: string }[] = [
    { id: '', label: 'Todas' }
  ];

  readonly presets: { id: DatePreset; label: string }[] = [
    { id: 'month', label: 'Mes en curso' },
    { id: '30d', label: '30 días' },
    { id: '3m', label: '3 meses' },
    { id: 'year', label: 'Año' },
    { id: 'custom', label: 'Personalizado' }
  ];

  constructor(
    private transactionService: TransactionService,
    public privacy: PrivacyService
  ) {}

  ngOnInit() {
    this.loadAccounts();
    this.loadCategoryCatalog();
    this.applyPreset('month');
    this.transactionService.dataRefresh$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadTransactions());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Transacciones filtradas: incluir todas */
  get filteredTransactions(): Transaction[] {
    let list = [...this.transactions];
    if (this.selectedAccounts.length > 0) {
      list = list.filter(t => this.selectedAccounts.includes(t.cuenta || ''));
    }
    return list;
  }

  /** Suma de los totales de cada categoría en "Gastos por categoría" */
  get totalGastos(): number {
    return this.categoriesSummary.reduce((sum, cat) => sum + cat.total, 0);
  }

  /** Suma de los totales de cada categoría en "Ingresos por categoría" */
  get totalIngresos(): number {
    return this.incomesSummary.reduce((sum, cat) => sum + cat.total, 0);
  }

  /** Balance = Ingresos + Gastos (coherente con los totales mostrados) */
  get totalBalance(): number {
    return this.totalIngresos + this.totalGastos;
  }

  get incomesSummary(): CategorySummary[] {
    const byCat = new Map<string, Map<string, Transaction[]>>();
    for (const t of this.filteredTransactions) {
      if ((t.importe || 0) <= 0) continue;
      const cat = t.categoria || 'Sin categoría';
      const sub = t.subcategoria || 'Sin subcategoría';
      if (!byCat.has(cat)) byCat.set(cat, new Map());
      const subMap = byCat.get(cat)!;
      if (!subMap.has(sub)) subMap.set(sub, []);
      subMap.get(sub)!.push(t);
    }
    return Array.from(byCat.entries()).map(([categoria, subMap]) => {
      const subcategories: SubcategorySummary[] = Array.from(subMap.entries()).map(([subcategoria, transactions]) => ({
        subcategoria,
        total: transactions.reduce((s, tx) => s + (tx.importe || 0), 0),
        transactions: transactions.sort((a, b) => (b.dt_date || '').localeCompare(a.dt_date || ''))
      }));
      return {
        categoria,
        total: subcategories.reduce((s, sc) => s + sc.total, 0),
        subcategories: subcategories.sort((a, b) => b.total - a.total)
      };
    }).sort((a, b) => b.total - a.total);
  }

  get categoriesSummary(): CategorySummary[] {
    const byCat = new Map<string, Map<string, Transaction[]>>();
    for (const t of this.filteredTransactions) {
      if ((t.importe || 0) >= 0) continue;
      const cat = t.categoria || 'Sin categoría';
      const sub = t.subcategoria || 'Sin subcategoría';
      if (!byCat.has(cat)) byCat.set(cat, new Map());
      const subMap = byCat.get(cat)!;
      if (!subMap.has(sub)) subMap.set(sub, []);
      subMap.get(sub)!.push(t);
    }
    return Array.from(byCat.entries()).map(([categoria, subMap]) => {
      const subcategories: SubcategorySummary[] = Array.from(subMap.entries()).map(([subcategoria, transactions]) => ({
        subcategoria,
        total: transactions.reduce((s, tx) => s + (tx.importe || 0), 0),
        transactions: transactions.sort((a, b) => (b.dt_date || '').localeCompare(a.dt_date || ''))
      }));
      return {
        categoria,
        total: subcategories.reduce((s, sc) => s + sc.total, 0),
        subcategories: subcategories.sort((a, b) => a.total - b.total)
      };
    }).sort((a, b) => a.total - b.total);
  }

  loadTransactions() {
    this.loading = true;
    this.showLoader = true;
    this.error = null;
    this.transactionService.getTransactions({
      from_date: this.fromDate || undefined,
      to_date: this.toDate || undefined,
      limit: 1000,
      offset: 0
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
          categoria: t.categoria || t.category,
          subcategoria: t.subcategoria
        }));
        this.transactions = mapped;
        this.loading = false;
        this.showLoader = false;
      },
      error: (err) => {
        this.error = err.error?.detail || 'Error al cargar. ¿Backend conectado?';
        this.loading = false;
        this.showLoader = false;
      }
    });
  }

  private loadCategoryCatalog(): void {
    this.transactionService.getCategoryCatalog().subscribe({
      next: (res) => {
        if (res?.success && Array.isArray(res.categories)) {
          this.catalogCategories = res.categories;
          this.catalogSubByCategory = res.subcategories_by_category || {};
        } else {
          this.catalogCategories = [];
          this.catalogSubByCategory = {};
        }
      },
      error: () => {
        this.catalogCategories = [];
        this.catalogSubByCategory = {};
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

  private getCatalogSubsForCategory(cat: string): string[] {
    const key = this.findCatalogCategoryKey(cat);
    if (!key) return [];
    return this.catalogSubByCategory[key] || [];
  }

  get allCategories(): string[] {
    const fromTx: string[] = [];
    const seen = new Set<string>();
    for (const t of this.transactions) {
      const c = (t.categoria || '').toString().trim();
      if (c && !seen.has(c.toLowerCase())) {
        seen.add(c.toLowerCase());
        fromTx.push(c);
      }
    }
    return mergeUniqueSortedCategories(fromTx, this.catalogCategories);
  }

  getSubcategoriesFor(categoria: string): string[] {
    const key = (categoria || '').toString().trim();
    if (!key) return [];
    const set = new Set<string>();
    for (const t of this.transactions) {
      const c = (t.categoria || '').toString().trim();
      if (c.toLowerCase() !== key.toLowerCase()) continue;
      const s = (t.subcategoria || '').toString().trim();
      if (s) set.add(s);
    }
    for (const s of this.getCatalogSubsForCategory(key)) {
      set.add(s);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }

  getEffectiveEditSubcategoria(): string {
    if (this.editDraftSubcategoria === ADD_NEW_SUBCATEGORY) {
      return (this.editDraftSubcategoriaCustom || '').toString().trim();
    }
    return (this.editDraftSubcategoria || '').toString().trim();
  }

  onEditModalCategoriaChange(): void {
    const cat = (this.editDraftCategoria || '').trim();
    const opts = this.getSubcategoriesFor(cat);
    const eff = this.getEffectiveEditSubcategoria();
    if (this.editDraftSubcategoria === ADD_NEW_SUBCATEGORY) {
      if (eff && opts.includes(eff)) {
        this.editDraftSubcategoria = eff;
        this.editDraftSubcategoriaCustom = '';
      }
    } else if (this.editDraftSubcategoria && !opts.includes(this.editDraftSubcategoria)) {
      this.editDraftSubcategoria = '';
      this.editDraftSubcategoriaCustom = '';
    }
  }

  private loadAccounts() {
    this.transactionService.getAccounts().subscribe({
      next: (res) => {
        const data = res?.data || [];
        this.accounts = data;
        this.accountFilters = [
          { id: '', label: 'Todas' },
          ...data.map(acc => ({
            id: acc.display_name,
            label: acc.display_name
          }))
        ];
      },
      error: () => {
        this.accounts = [];
        this.accountFilters = [{ id: '', label: 'Todas' }];
      }
    });
  }

  isAccountSelected(id: string): boolean {
    if (!id) {
      // Chip "Todas" activo cuando no hay filtros aplicados
      return this.selectedAccounts.length === 0;
    }
    return this.selectedAccounts.includes(id);
  }

  toggleAccount(id: string): void {
    if (!id) {
      // Al pulsar "Todas" limpiamos todos los filtros
      this.selectedAccounts = [];
      return;
    }
    if (this.selectedAccounts.includes(id)) {
      this.selectedAccounts = this.selectedAccounts.filter(a => a !== id);
    } else {
      this.selectedAccounts = [...this.selectedAccounts, id];
    }
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

  toggleCategory(categoria: string) {
    this.expandedCategory = this.expandedCategory === categoria ? null : categoria;
  }

  toggleSubcategory(categoria: string, subcategoria: string) {
    const key = makeSubKey(categoria, subcategoria);
    this.expandedSubcategoryKey = this.expandedSubcategoryKey === key ? null : key;
  }

  toggleIncomeCategory(categoria: string) {
    this.expandedIncomeCategory = this.expandedIncomeCategory === categoria ? null : categoria;
  }

  toggleIncomeSubcategory(categoria: string, subcategoria: string) {
    const key = makeSubKey(categoria, subcategoria);
    this.expandedIncomeSubcategoryKey = this.expandedIncomeSubcategoryKey === key ? null : key;
  }

  isSubcategoryExpanded(categoria: string, subcategoria: string): boolean {
    return this.expandedSubcategoryKey === makeSubKey(categoria, subcategoria);
  }

  isIncomeSubcategoryExpanded(categoria: string, subcategoria: string): boolean {
    return this.expandedIncomeSubcategoryKey === makeSubKey(categoria, subcategoria);
  }

  formatDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  formatDisplayDate(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  }

  getAccountLabel(cuenta?: string): string {
    return cuenta || '';
  }

  /** Misma lógica que Ajustes para `datetime-local`. */
  getDateTimeForInput(dt_date: string | undefined): string {
    if (!dt_date) return '';
    const s = String(dt_date).trim();
    if (s.includes('T')) {
      const part = s.slice(0, 19);
      if (part.length >= 19) return part;
      if (part.length === 16) return part + ':00';
      return part + '00:00:00'.slice(0, 19 - part.length);
    }
    return s.slice(0, 10) + 'T00:00:00';
  }

  openEditModal(tx: Transaction): void {
    if (!tx?.id) return;
    this.editModalTx = tx;
    this.editDraftDateTime = this.getDateTimeForInput(tx.dt_date);
    this.editDraftDesc = (tx.descripcion || '').trim();
    this.editDraftCategoria = (tx.categoria || '').trim();
    const sub = (tx.subcategoria || '').toString().trim();
    const subList = this.getSubcategoriesFor(this.editDraftCategoria);
    if (sub && !subList.includes(sub)) {
      this.editDraftSubcategoria = ADD_NEW_SUBCATEGORY;
      this.editDraftSubcategoriaCustom = sub;
    } else {
      this.editDraftSubcategoria = sub;
      this.editDraftSubcategoriaCustom = '';
    }
    this.editError = null;
  }

  closeEditModal(): void {
    this.editModalTx = null;
    this.savingEdit = false;
    this.deletingEdit = false;
    this.editError = null;
    this.editDraftCategoria = '';
    this.editDraftSubcategoria = '';
    this.editDraftSubcategoriaCustom = '';
  }

  deleteEditModal(): void {
    const tx = this.editModalTx;
    if (!tx?.id) {
      this.closeEditModal();
      return;
    }
    this.editError = null;
    this.deletingEdit = true;
    const id = tx.id;
    this.transactionService.deleteTransaction(id).subscribe({
      next: () => {
        this.deletingEdit = false;
        this.closeEditModal();
        this.transactionService.dataRefresh$.next();
      },
      error: (err) => {
        this.editError = err.error?.detail || 'Error al eliminar';
        this.deletingEdit = false;
      }
    });
  }

  private buildDetailsPatch(tx: Transaction): { dt_date?: string; descripcion?: string } | null {
    const raw = this.editDraftDateTime.trim();
    const dtNew = raw
      ? raw.length >= 19
        ? raw.slice(0, 19)
        : (raw + ':00'.slice(0, 19 - raw.length)).slice(0, 19)
      : '';
    const origNorm = this.getDateTimeForInput(tx.dt_date).slice(0, 19);
    const descNew = this.editDraftDesc.trim();
    const descOrig = (tx.descripcion || '').trim();
    const patch: { dt_date?: string; descripcion?: string } = {};
    if (dtNew && dtNew !== origNorm) {
      patch.dt_date = raw.length >= 19 ? raw.slice(0, 19) : raw + ':00'.slice(0, 19 - raw.length);
    }
    if (descNew !== descOrig) {
      patch.descripcion = descNew;
    }
    return Object.keys(patch).length > 0 ? patch : null;
  }

  private buildCategoryPatch(tx: Transaction): { categoria: string | null; subcategoria: string | null } | null {
    const cat = (this.editDraftCategoria || '').trim() || null;
    let sub = this.getEffectiveEditSubcategoria() || null;
    if (this.editDraftSubcategoria === ADD_NEW_SUBCATEGORY && !((sub || '') as string).trim()) {
      sub = null;
    }
    const oCat = (tx.categoria || '').trim() || null;
    const oSub = (tx.subcategoria || '').trim() || null;
    const nCat = cat;
    const nSub = sub;
    if (oCat === nCat && oSub === nSub) return null;
    return { categoria: nCat, subcategoria: nSub };
  }

  saveEditModal(): void {
    const tx = this.editModalTx;
    if (!tx?.id) {
      this.closeEditModal();
      return;
    }
    if (this.editDraftSubcategoria === ADD_NEW_SUBCATEGORY && !this.getEffectiveEditSubcategoria()) {
      this.editError = 'Escribe la subcategoría nueva o elige otra opción.';
      return;
    }
    this.editError = null;
    const detPatch = this.buildDetailsPatch(tx);
    const catPatch = this.buildCategoryPatch(tx);
    if (!detPatch && !catPatch) {
      this.closeEditModal();
      return;
    }
    this.savingEdit = true;
    const id = tx.id;
    const chain =
      catPatch && detPatch
        ? this.transactionService
            .updateTransactionCategory(id, catPatch.categoria, catPatch.subcategoria)
            .pipe(switchMap(() => this.transactionService.updateTransactionDetails(id, detPatch)))
        : catPatch
          ? this.transactionService.updateTransactionCategory(id, catPatch.categoria, catPatch.subcategoria)
          : this.transactionService.updateTransactionDetails(id, detPatch!);
    chain.subscribe({
      next: () => {
        this.savingEdit = false;
        this.closeEditModal();
        this.transactionService.dataRefresh$.next();
      },
      error: (err) => {
        this.editError = err.error?.detail || 'Error al guardar';
        this.savingEdit = false;
      }
    });
  }
}
