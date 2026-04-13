import { Component, OnInit } from '@angular/core';
import { trigger, transition, style, animate } from '@angular/animations';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Transaction } from '../../models/transaction.model';
import { getAccountColorForName } from '../../utils/account-colors';
import { TransactionService } from '../../services/transaction.service';
import { AuthService } from '../../services/auth.service';
import { getTransactionIconInfo } from '../../utils/transaction-icons';

interface EditSubcategoryGroup {
  subcategoria: string;
  transactions: Transaction[];
}

interface EditCategoryGroup {
  categoria: string;
  subcategories: EditSubcategoryGroup[];
}

interface EditAccountGroup {
  cuenta: string;
  transactions: Transaction[];
}

interface AccountFilterMonthNode {
  ym: string;
  label: string;
}

interface AccountFilterYearNode {
  year: string;
  months: AccountFilterMonthNode[];
}

function makeSubKey(cat: string, sub: string): string {
  return `${cat || 'Sin categoría'}::${sub || 'Sin subcategoría'}`;
}

/** Une listas de categorías sin duplicar por mayúsculas/minúsculas; orden es-ES. */
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

/** Valor especial en el desplegable para "añadir subcategoría manualmente" */
const ADD_NEW_SUBCATEGORY = '__ADD_NEW__';

@Component({
  selector: 'app-ajustes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ajustes.component.html',
  styleUrl: './ajustes.component.scss',
  animations: [
    trigger('loaderOverlay', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('200ms ease-out', style({ opacity: 1 }))
      ]),
      transition(':leave', [
        animate('180ms ease-in', style({ opacity: 0 }))
      ])
    ])
  ]
})
export class AjustesComponent implements OnInit {
  transactions: Transaction[] = [];
  loading = false;
  showLoader = false;
  error: string | null = null;

  /** ids en guardado */
  private savingKeys = new Set<string>();
  /** borrador local de categoría/subcategoría por id */
  draftCategoria: Record<string, string> = {};
  draftSubcategoria: Record<string, string> = {};
  /** texto de subcategoría cuando el usuario elige "Añadir nueva" */
  draftSubcategoriaCustom: Record<string, string> = {};
  /** valor del desplegable para opción "Añadir nueva" (expuesto en template) */
  addNewSubcategoryValue = ADD_NEW_SUBCATEGORY;
  /** feedback de guardado */
  lastSavedId: number | null = null;
  lastSaveMessage: string | null = null;

  /** Catálogo desde reglas del backend (además de categorías vistas en transacciones). */
  catalogCategories: string[] = [];
  catalogSubByCategory: Record<string, string[]> = {};

  /** texto de búsqueda para el editor general */
  searchText = '';

  expandedCategory: string | null = null;
  expandedSubKey: string | null = null;

  /** Meses seleccionados (`YYYY-MM`). Vacío = no filtrar por mes. */
  selectedAccountMonths: Record<string, true> = {};
  /** Año del filtro desplegado en el árbol (`false` = colapsado). Por defecto todos abiertos. */
  expandedAccountFilterYears: Record<string, boolean> = {};
  /** Popover del filtro por meses (no empuja el contenido de la página). */
  accountMonthFilterPopoverOpen = false;

  /** Editor por cuenta: una cuenta desplegada a la vez */
  expandedAccount: string | null = null;
  /** Selección de ids para acciones en bloque (solo vista por cuenta) */
  selectedTxIds: Record<number, true> = {};
  bulkBatchCategoria = '';
  bulkBatchSubcategoria = '';
  bulkBatchSubcategoriaCustom = '';
  bulkBusy = false;
  bulkBarError: string | null = null;
  bulkResultMessage: string | null = null;
  confirmModalOpen = false;
  pendingTx: Transaction | null = null;
  pendingCategoria = '';
  pendingSubcategoria = '';

  /** Modal editar detalles de la transacción */
  editModalTx: Transaction | null = null;
  /** Fecha y hora original (YYYY-MM-DDTHH:mm:ss) para datetime-local */
  editDraftDateTime = '';
  editDraftDesc = '';
  savingEdit = false;
  deletingEdit = false;
  editError: string | null = null;

  constructor(
    private transactionService: TransactionService,
    private auth: AuthService
  ) {}

  ngOnInit(): void {
    this.loadCategoryCatalog();
    this.loadTransactions();
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
        this.reconcileDraftSubcategories();
      },
      error: (err) => {
        console.warn('[Ajustes] category catalog unavailable', err);
        this.catalogCategories = [];
        this.catalogSubByCategory = {};
      }
    });
  }

  /** Coincidencia de nombre de categoría con las claves del catálogo (case-insensitive). */
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

  /**
   * Si el catálogo llega después de las transacciones, pasa de "Añadir nueva" a opción de lista cuando aplique.
   */
  private reconcileDraftSubcategories(): void {
    for (const t of this.transactions) {
      if (t.id == null) continue;
      const key = String(t.id);
      const cat = (this.draftCategoria[key] ?? t.categoria ?? '').toString().trim();
      const subList = this.getSubcategoriesFor(cat);
      if (this.draftSubcategoria[key] === ADD_NEW_SUBCATEGORY) {
        const custom = (this.draftSubcategoriaCustom[key] || '').toString().trim();
        if (custom && subList.includes(custom)) {
          this.draftSubcategoria[key] = custom;
          delete this.draftSubcategoriaCustom[key];
        }
      }
    }
  }

  getIconInfo(t: Transaction) {
    return getTransactionIconInfo(t);
  }

  onIconError(ev: Event) {
    const img = ev.target as HTMLImageElement;
    if (img && !img.src.endsWith('/icons/default.svg')) img.src = '/icons/default.svg';
  }

  getAccountLabelShort(cuenta?: string): string {
    if (!cuenta) return '';
    return cuenta.length > 10 ? cuenta.slice(0, 9) + '…' : cuenta;
  }

  getAccountColorStyle(cuenta?: string): { [key: string]: string } {
    const { bg, fg } = getAccountColorForName(cuenta || '');
    return {
      'background-color': bg,
      color: fg
    };
  }

  private txKey(t: Transaction): string {
    return String(t.id ?? t.transaction_id ?? '');
  }

  isSaving(t: Transaction): boolean {
    return this.savingKeys.has(this.txKey(t));
  }

  loadTransactions(): void {
    this.loading = true;
    this.showLoader = true;
    this.error = null;
    this.transactionService.getTransactions().subscribe({
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
          categoria: t.categoria || t.category || '',
          subcategoria: t.subcategoria || t.Subcategoria || ''
        }));
        this.transactions = mapped;
        // Inicializar borradores
        this.draftCategoria = {};
        this.draftSubcategoria = {};
        this.draftSubcategoriaCustom = {};
        for (const t of mapped) {
          if (t.id != null) {
            const key = String(t.id);
            const cat = t.categoria || '';
            const sub = (t.subcategoria || '').toString().trim();
            this.draftCategoria[key] = cat;
            const subList = this.getSubcategoriesFor(cat);
            if (sub && !subList.includes(sub)) {
              this.draftSubcategoria[key] = ADD_NEW_SUBCATEGORY;
              this.draftSubcategoriaCustom[key] = sub;
            } else {
              this.draftSubcategoria[key] = t.subcategoria || '';
            }
          }
        }
        this.reconcileDraftSubcategories();
        this.pruneAccountMonthFilterToLoadedData();
        this.loading = false;
        this.showLoader = false;
      },
      error: (err) => {
        console.error('[Ajustes] error loadTransactions', err);
        this.error = err.error?.detail || 'Error al cargar transacciones';
        this.loading = false;
        this.showLoader = false;
      }
    });
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

  get filteredTransactions(): Transaction[] {
    let list = [...this.transactions];
    if (this.searchText && this.searchText.trim()) {
      const q = this.searchText.trim().toLowerCase();
      list = list.filter(t =>
        (t.descripcion || '').toLowerCase().includes(q) ||
        (t.categoria || '').toLowerCase().includes(q) ||
        (t.subcategoria || '').toLowerCase().includes(q) ||
        (t.cuenta || '').toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => (b.dt_date || '').localeCompare(a.dt_date || ''));
  }

  get bulkSelectedIds(): number[] {
    return Object.keys(this.selectedTxIds)
      .map((k) => +k)
      .filter((id) => this.selectedTxIds[id] === true && Number.isFinite(id));
  }

  get bulkSelectedCount(): number {
    return this.bulkSelectedIds.length;
  }

  private distinctYearMonthsFromTransactions(): string[] {
    const set = new Set<string>();
    for (const t of this.transactions) {
      const raw = (t.dt_date || '').toString().trim();
      if (raw.length >= 7) {
        const ym = raw.slice(0, 7);
        if (/^\d{4}-\d{2}$/.test(ym)) set.add(ym);
      }
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }

  /** Árbol año → meses (solo meses que existen en los datos). Años de más reciente a más antiguo. */
  get accountMonthYearTree(): AccountFilterYearNode[] {
    const yms = this.distinctYearMonthsFromTransactions();
    const byYear = new Map<string, string[]>();
    for (const ym of yms) {
      const y = ym.slice(0, 4);
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y)!.push(ym);
    }
    const years = Array.from(byYear.keys()).sort((a, b) => b.localeCompare(a));
    return years.map((year) => ({
      year,
      months: (byYear.get(year) || [])
        .sort((a, b) => b.localeCompare(a))
        .map((ym) => ({ ym, label: this.formatMonthOnlyLabel(ym) }))
    }));
  }

  private formatMonthOnlyLabel(ym: string): string {
    const parts = ym.split('-');
    const y = +parts[0];
    const m = +parts[1];
    if (!y || !m || m < 1 || m > 12) return ym;
    const d = new Date(Date.UTC(y, m - 1, 1));
    const s = d.toLocaleDateString('es-ES', { month: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  private pruneAccountMonthFilterToLoadedData(): void {
    const valid = new Set(this.distinctYearMonthsFromTransactions());
    const next: Record<string, true> = {};
    for (const k of Object.keys(this.selectedAccountMonths)) {
      if (valid.has(k)) next[k] = true;
    }
    this.selectedAccountMonths = next;
  }

  get selectedAccountMonthKeys(): string[] {
    return Object.keys(this.selectedAccountMonths).filter((k) => this.selectedAccountMonths[k] === true);
  }

  get hasAccountMonthFilter(): boolean {
    return this.selectedAccountMonthKeys.length > 0;
  }

  isAccountMonthFilterSelected(ym: string): boolean {
    return this.selectedAccountMonths[ym] === true;
  }

  filterYearMonthKeys(year: string): string[] {
    const node = this.accountMonthYearTree.find((n) => n.year === year);
    return node ? node.months.map((m) => m.ym) : [];
  }

  isFilterYearFullySelected(year: string): boolean {
    const months = this.filterYearMonthKeys(year);
    if (months.length === 0) return false;
    return months.every((ym) => this.selectedAccountMonths[ym] === true);
  }

  isFilterYearPartiallySelected(year: string): boolean {
    const months = this.filterYearMonthKeys(year);
    const n = months.filter((ym) => this.selectedAccountMonths[ym] === true).length;
    return n > 0 && n < months.length;
  }

  isAccountFilterYearExpanded(year: string): boolean {
    return this.expandedAccountFilterYears[year] !== false;
  }

  toggleAccountFilterYearExpand(year: string): void {
    const open = this.isAccountFilterYearExpanded(year);
    this.expandedAccountFilterYears = { ...this.expandedAccountFilterYears, [year]: !open };
  }

  onFilterYearCheckboxClick(ev: MouseEvent, year: string): void {
    ev.preventDefault();
    this.toggleFilterYear(year);
  }

  onFilterMonthCheckboxClick(ev: MouseEvent, ym: string): void {
    ev.preventDefault();
    this.toggleFilterMonth(ym);
  }

  toggleFilterMonth(ym: string): void {
    const next: Record<string, true> = { ...this.selectedAccountMonths };
    if (next[ym]) delete next[ym];
    else next[ym] = true;
    this.selectedAccountMonths = next;
    this.bulkBarError = null;
    this.bulkResultMessage = null;
  }

  toggleFilterYear(year: string): void {
    const months = this.filterYearMonthKeys(year);
    if (months.length === 0) return;
    const next: Record<string, true> = { ...this.selectedAccountMonths };
    const allOn = this.isFilterYearFullySelected(year);
    if (allOn) {
      for (const ym of months) delete next[ym];
    } else {
      for (const ym of months) next[ym] = true;
    }
    this.selectedAccountMonths = next;
    this.bulkBarError = null;
    this.bulkResultMessage = null;
  }

  /**
   * Movimientos visibles en «Por cuenta»: filtros propios de la sección sobre todas las transacciones cargadas.
   */
  get filteredForAccountSection(): Transaction[] {
    let list = [...this.transactions];

    if (this.hasAccountMonthFilter) {
      const allowed = new Set(this.selectedAccountMonthKeys);
      list = list.filter((t) => {
        const raw = (t.dt_date || '').toString().trim();
        return raw.length >= 7 && allowed.has(raw.slice(0, 7));
      });
    }

    return list.sort((a, b) => (b.dt_date || '').localeCompare(a.dt_date || ''));
  }

  clearAccountSectionFilters(): void {
    this.selectedAccountMonths = {};
  }

  openAccountMonthFilterPopover(): void {
    this.accountMonthFilterPopoverOpen = true;
  }

  closeAccountMonthFilterPopover(): void {
    this.accountMonthFilterPopoverOpen = false;
  }

  /**
   * Movimientos agrupados por cuenta (texto `cuenta`); usa los filtros de la sección «Por cuenta».
   */
  get groupedByAccount(): EditAccountGroup[] {
    const byAcc = new Map<string, Transaction[]>();
    for (const t of this.filteredForAccountSection) {
      const acc = (t.cuenta || '').toString().trim() || 'Sin cuenta';
      if (!byAcc.has(acc)) byAcc.set(acc, []);
      byAcc.get(acc)!.push(t);
    }
    const groups: EditAccountGroup[] = Array.from(byAcc.entries()).map(([cuenta, transactions]) => ({
      cuenta,
      transactions: transactions.sort((a, b) => (b.dt_date || '').localeCompare(a.dt_date || ''))
    }));
    groups.sort((a, b) => {
      const aSin = a.cuenta === 'Sin cuenta';
      const bSin = b.cuenta === 'Sin cuenta';
      if (aSin !== bSin) return aSin ? 1 : -1;
      return a.cuenta.localeCompare(b.cuenta, 'es', { sensitivity: 'base' });
    });
    return groups;
  }

  toggleAccount(cuenta: string): void {
    this.expandedAccount = this.expandedAccount === cuenta ? null : cuenta;
  }

  isAccountExpanded(cuenta: string): boolean {
    return this.expandedAccount === cuenta;
  }

  toggleAccountTxSelect(t: Transaction): void {
    const id = t.id;
    if (id == null) return;
    const next: Record<number, true> = { ...this.selectedTxIds };
    if (next[id]) {
      delete next[id];
    } else {
      next[id] = true;
    }
    this.selectedTxIds = next;
    this.bulkBarError = null;
    this.bulkResultMessage = null;
  }

  isAccountTxSelected(t: Transaction): boolean {
    const id = t.id;
    if (id == null) return false;
    return this.selectedTxIds[id] === true;
  }

  selectAllInAccount(cuenta: string): void {
    const g = this.groupedByAccount.find((x) => x.cuenta === cuenta);
    if (!g) return;
    const next: Record<number, true> = { ...this.selectedTxIds };
    for (const tx of g.transactions) {
      if (tx.id != null) next[tx.id] = true;
    }
    this.selectedTxIds = next;
    this.bulkBarError = null;
    this.bulkResultMessage = null;
  }

  deselectAllInAccount(cuenta: string): void {
    const g = this.groupedByAccount.find((x) => x.cuenta === cuenta);
    if (!g) return;
    const next: Record<number, true> = { ...this.selectedTxIds };
    for (const tx of g.transactions) {
      if (tx.id != null) delete next[tx.id];
    }
    this.selectedTxIds = next;
  }

  clearBulkSelection(): void {
    this.selectedTxIds = {};
    this.bulkBarError = null;
    this.bulkResultMessage = null;
  }

  /** Clave de cuenta igual que en `groupedByAccount`. */
  private accountKeyForTx(t: Transaction): string {
    return (t.cuenta || '').toString().trim() || 'Sin cuenta';
  }

  /** Ids seleccionados que pertenecen a esa cuenta (clave de agrupación). */
  selectedIdsForAccount(cuentaKey: string): number[] {
    return this.bulkSelectedIds.filter((id) => {
      const tx = this.transactions.find((x) => x.id === id);
      return !!tx && this.accountKeyForTx(tx) === cuentaKey;
    });
  }

  selectedCountForAccount(cuentaKey: string): number {
    return this.selectedIdsForAccount(cuentaKey).length;
  }

  getEffectiveBulkSubcategoria(): string {
    if (this.bulkBatchSubcategoria === ADD_NEW_SUBCATEGORY) {
      return (this.bulkBatchSubcategoriaCustom || '').toString().trim();
    }
    return (this.bulkBatchSubcategoria || '').toString().trim();
  }

  deleteBulkForAccount(cuentaKey: string, ev: MouseEvent): void {
    ev.stopPropagation();
    ev.preventDefault();
    this.bulkBarError = null;
    this.bulkResultMessage = null;
    const ids = this.selectedIdsForAccount(cuentaKey);
    if (ids.length === 0) return;
    const n = ids.length;
    const okDel = confirm(
      `¿Eliminar ${n} ${n === 1 ? 'movimiento' : 'movimientos'} de «${cuentaKey}»? Esta acción no se puede deshacer.`
    );
    if (!okDel) return;
    void this.runBulkDeleteIds(ids);
  }

  private applyCategoryToLocalState(id: number, categoria: string | null, subcategoria: string | null): void {
    const t = this.transactions.find((x) => x.id === id);
    if (!t) return;
    const cat = (categoria ?? '').toString().trim();
    const sub = (subcategoria ?? '').toString().trim();
    t.categoria = cat;
    t.subcategoria = sub;
    const key = String(id);
    this.draftCategoria[key] = cat;
    const subList = this.getSubcategoriesFor(cat);
    if (sub && !subList.includes(sub)) {
      this.draftSubcategoria[key] = ADD_NEW_SUBCATEGORY;
      this.draftSubcategoriaCustom[key] = sub;
    } else {
      this.draftSubcategoria[key] = sub;
      delete this.draftSubcategoriaCustom[key];
    }
  }

  async applyBulkCategoryForAccount(cuentaKey: string): Promise<void> {
    this.bulkBarError = null;
    this.bulkResultMessage = null;
    const ids = this.selectedIdsForAccount(cuentaKey);
    if (ids.length === 0) {
      this.bulkBarError = 'No hay movimientos seleccionados en esta cuenta.';
      return;
    }
    if (this.bulkBatchSubcategoria === ADD_NEW_SUBCATEGORY && !this.getEffectiveBulkSubcategoria()) {
      this.bulkBarError = 'Escribe la subcategoría nueva o elige otra opción.';
      return;
    }
    const categoriaDraft = (this.bulkBatchCategoria || '').trim();
    const subcategoriaDraft = this.getEffectiveBulkSubcategoria();
    const categoria = categoriaDraft || null;
    const subcategoria = subcategoriaDraft || null;
    const catLabel = categoriaDraft || 'Sin categoría';
    const subLabel =
      this.bulkBatchSubcategoria === ADD_NEW_SUBCATEGORY
        ? this.bulkBatchSubcategoriaCustom || 'Sin subcategoría'
        : this.bulkBatchSubcategoria || 'Sin subcategoría';
    const n = ids.length;
    const okApply = confirm(
      `¿Aplicar categoría «${catLabel}» y subcategoría «${subLabel}» a ${n} ${n === 1 ? 'movimiento' : 'movimientos'} de «${cuentaKey}»?`
    );
    if (!okApply) return;

    this.bulkBusy = true;
    this.bulkResultMessage = null;
    const nextSel: Record<number, true> = { ...this.selectedTxIds };
    try {
      const res = await firstValueFrom(
        this.transactionService.updateTransactionsCategoryBatch(ids, categoria, subcategoria)
      );
      const updatedIds = res.updated_ids || [];
      for (const id of updatedIds) {
        this.applyCategoryToLocalState(id, categoria, subcategoria);
        delete nextSel[id];
      }
      this.selectedTxIds = nextSel;
      const n = res.updated ?? updatedIds.length;
      this.bulkResultMessage = n === 1 ? '1 movimiento actualizado.' : `${n} movimientos actualizados.`;
      this.reconcileDraftSubcategories();
    } catch (err: any) {
      this.bulkBarError = err?.error?.detail || 'Error al actualizar categorías';
    } finally {
      this.bulkBusy = false;
    }
  }

  private async runBulkDeleteIds(ids: number[]): Promise<void> {
    this.bulkBusy = true;
    this.bulkResultMessage = null;
    const nextSel: Record<number, true> = { ...this.selectedTxIds };
    try {
      const res = await firstValueFrom(this.transactionService.deleteTransactionsBatch(ids));
      const deletedIds = res.deleted_ids || [];
      const idSet = new Set(deletedIds);
      this.transactions = this.transactions.filter((t) => t.id == null || !idSet.has(t.id));
      for (const id of deletedIds) {
        const key = String(id);
        delete this.draftCategoria[key];
        delete this.draftSubcategoria[key];
        delete this.draftSubcategoriaCustom[key];
        delete nextSel[id];
      }
      this.selectedTxIds = nextSel;
      const n = res.deleted ?? deletedIds.length;
      this.bulkResultMessage =
        n === 0 ? 'Ningún movimiento eliminado.' : n === 1 ? '1 movimiento eliminado.' : `${n} movimientos eliminados.`;
    } catch (err: any) {
      this.bulkBarError = err?.error?.detail || 'Error al eliminar';
    } finally {
      this.bulkBusy = false;
    }
  }

  private isOtherCategory(cat: string | undefined | null): boolean {
    const c = (cat || '').toString().trim().toLowerCase();
    return c === 'otro' || c === 'otros';
  }

  /** Movimientos con categoría Otro/Otros en todos los datos cargados (ignora el cuadro de búsqueda). */
  get otherCategoryCount(): number {
    return this.transactions.filter(t => this.isOtherCategory(t.categoria)).length;
  }

  /**
   * Todas las categorías que pasan el filtro de búsqueda; "Otro"/"Otros" van primero,
   * el resto ordenado alfabéticamente por nombre de categoría.
   */
  get groupedForEditor(): EditCategoryGroup[] {
    const byCat = new Map<string, Map<string, Transaction[]>>();
    for (const t of this.filteredTransactions) {
      const cat = t.categoria || 'Sin categoría';
      const sub = t.subcategoria || 'Sin subcategoría';
      if (!byCat.has(cat)) byCat.set(cat, new Map());
      const subMap = byCat.get(cat)!;
      if (!subMap.has(sub)) subMap.set(sub, []);
      subMap.get(sub)!.push(t);
    }
    const groups: EditCategoryGroup[] = Array.from(byCat.entries()).map(([categoria, subMap]) => {
      const subcategories: EditSubcategoryGroup[] = Array.from(subMap.entries()).map(
        ([subcategoria, transactions]) => ({
          subcategoria,
          transactions: transactions.sort((a, b) => (b.dt_date || '').localeCompare(a.dt_date || ''))
        })
      );
      return { categoria, subcategories };
    });
    groups.sort((a, b) => {
      const aOther = this.isOtherCategory(a.categoria);
      const bOther = this.isOtherCategory(b.categoria);
      if (aOther !== bOther) {
        return aOther ? -1 : 1;
      }
      return a.categoria.localeCompare(b.categoria, 'es', { sensitivity: 'base' });
    });
    return groups;
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

  /** Subcategoría efectiva: la del desplegable o la escrita en "Añadir nueva" */
  getEffectiveSubcategoria(t: Transaction): string {
    if (!t.id) return '';
    const key = String(t.id);
    if (this.draftSubcategoria[key] === ADD_NEW_SUBCATEGORY) {
      return (this.draftSubcategoriaCustom[key] || '').toString().trim();
    }
    return (this.draftSubcategoria[key] || '').toString().trim();
  }

  hasDraftChanges(t: Transaction): boolean {
    if (!t.id) return false;
    const key = String(t.id);
    const currentCat = (t.categoria || '').toString().trim();
    const currentSub = (t.subcategoria || '').toString().trim();
    const draftCat = (this.draftCategoria[key] || '').toString().trim();
    const draftSub = this.getEffectiveSubcategoria(t);
    return currentCat !== draftCat || currentSub !== draftSub;
  }

  openConfirmSave(t: Transaction): void {
    if (!t.id) {
      return;
    }
    const draftKey = String(t.id);
    const categoriaDraft = (this.draftCategoria[draftKey] || '').toString().trim();
    const subcategoriaDraft = this.getEffectiveSubcategoria(t);

    this.pendingTx = t;
    this.pendingCategoria = categoriaDraft;
    this.pendingSubcategoria = subcategoriaDraft;
    this.confirmModalOpen = true;
    this.lastSavedId = null;
    this.lastSaveMessage = null;
  }

  cancelSave(): void {
    this.confirmModalOpen = false;
    this.pendingTx = null;
  }

  confirmSave(): void {
    const t = this.pendingTx;
    if (!t || !t.id) {
      this.confirmModalOpen = false;
      return;
    }

    const draftKey = String(t.id);
    const categoriaDraft = (this.pendingCategoria || '').toString().trim();
    const subcategoriaDraft = (this.pendingSubcategoria || '').toString().trim();

    // sincronizar borradores por si han cambiado justo antes de abrir
    this.draftCategoria[draftKey] = categoriaDraft;
    this.draftSubcategoria[draftKey] = subcategoriaDraft;

    this.confirmModalOpen = false;

    this.lastSavedId = null;
    this.lastSaveMessage = null;
    const key = this.txKey(t);
    this.savingKeys.add(key);
    const categoria = categoriaDraft || null;
    const subcategoria = subcategoriaDraft || null;

    this.transactionService.updateTransactionCategory(t.id, categoria, subcategoria).subscribe({
      next: () => {
        this.savingKeys.delete(key);
        // Sincronizar modelo base con lo guardado
        t.categoria = categoria || '';
        t.subcategoria = subcategoria || '';
        // Salir del modo "Añadir nueva" y dejar el valor guardado en el desplegable
        this.draftSubcategoria[draftKey] = subcategoria || '';
        delete this.draftSubcategoriaCustom[draftKey];
        this.lastSavedId = t.id || null;
        this.lastSaveMessage = 'Cambios guardados';
      },
      error: (err) => {
        console.error('[Ajustes] error saveCategory', err);
        this.error = err.error?.detail || 'Error al guardar categoría';
        this.savingKeys.delete(key);
        this.lastSavedId = t.id || null;
        this.lastSaveMessage = 'Error al guardar';
      }
    });
  }

  toggleCategory(categoria: string): void {
    this.expandedCategory = this.expandedCategory === categoria ? null : categoria;
  }

  toggleSubcategory(categoria: string, subcategoria: string): void {
    const key = makeSubKey(categoria, subcategoria);
    this.expandedSubKey = this.expandedSubKey === key ? null : key;
  }

  isSubcategoryExpanded(categoria: string, subcategoria: string): boolean {
    return this.expandedSubKey === makeSubKey(categoria, subcategoria);
  }

  /** Rescata la fecha/hora original de la transacción para input type="datetime-local" (YYYY-MM-DDTHH:mm:ss) */
  getDateTimeForInput(dt_date: string | undefined): string {
    if (!dt_date) return '';
    const s = String(dt_date).trim();
    if (s.includes('T')) {
      const part = s.slice(0, 19);
      if (part.length >= 19) return part;
      if (part.length === 16) return part + ':00'; // YYYY-MM-DDTHH:mm → añadir segundos
      return part + '00:00:00'.slice(0, 19 - part.length);
    }
    return s.slice(0, 10) + 'T00:00:00';
  }

  openEditModal(tx: Transaction): void {
    if (!tx) return;
    this.editModalTx = tx;
    this.editDraftDateTime = this.getDateTimeForInput(tx.dt_date);
    this.editDraftDesc = (tx.descripcion || '').trim();
    this.editError = null;
  }

  closeEditModal(): void {
    this.editModalTx = null;
    this.savingEdit = false;
    this.deletingEdit = false;
    this.editError = null;
  }

  deleteEditModal(): void {
    const tx = this.editModalTx;
    if (!tx || !tx.id) {
      this.closeEditModal();
      return;
    }
    this.editError = null;
    this.deletingEdit = true;
    const id = tx.id;
    this.transactionService.deleteTransaction(id).subscribe({
      next: () => {
        this.transactions = this.transactions.filter(t => t.id !== id);
        const key = String(id);
        delete this.draftCategoria[key];
        delete this.draftSubcategoria[key];
        this.deletingEdit = false;
        this.closeEditModal();
      },
      error: (err) => {
        this.editError = err.error?.detail || 'Error al eliminar';
        this.deletingEdit = false;
      }
    });
  }

  saveEditModal(): void {
    const tx = this.editModalTx;
    if (!tx || !tx.id) {
      this.closeEditModal();
      return;
    }
    this.editError = null;
    this.savingEdit = true;

    const raw = this.editDraftDateTime.trim();
    const dt_date = raw
      ? (raw.length >= 19 ? raw : raw + ':00'.slice(0, 19 - raw.length))
      : undefined;
    const descripcion = this.editDraftDesc.trim() || undefined;

    const details: { dt_date?: string; descripcion?: string } = {};
    if (dt_date) details.dt_date = dt_date;
    if (descripcion !== undefined) details.descripcion = descripcion;

    this.transactionService.updateTransactionDetails(tx.id, details).subscribe({
      next: () => {
        if (dt_date) tx.dt_date = dt_date;
        if (descripcion !== undefined) tx.descripcion = descripcion;
        this.savingEdit = false;
        this.closeEditModal();
      },
      error: (err) => {
        this.editError = err.error?.detail || 'Error al guardar';
        this.savingEdit = false;
      }
    });
  }

}
