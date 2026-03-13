import { Component, OnInit } from '@angular/core';
import { trigger, transition, style, animate } from '@angular/animations';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Transaction, Account } from '../../models/transaction.model';
import { TransactionService } from '../../services/transaction.service';
import { getTransactionIconInfo } from '../../utils/transaction-icons';

interface EditSubcategoryGroup {
  subcategoria: string;
  transactions: Transaction[];
}

interface EditCategoryGroup {
  categoria: string;
  subcategories: EditSubcategoryGroup[];
}

function makeSubKey(cat: string, sub: string): string {
  return `${cat || 'Sin categoría'}::${sub || 'Sin subcategoría'}`;
}

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
  /** feedback de guardado */
  lastSavedId: number | null = null;
  lastSaveMessage: string | null = null;

  /** texto de búsqueda para el editor general */
  searchText = '';

  expandedCategory: string | null = null;
  expandedSubKey: string | null = null;
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

  /** Editor de cuentas */
  accounts: Account[] = [];
  accountsLoading = false;
  accountsError: string | null = null;
  accountDraftName: Record<string, string> = {};
  editingAccountId: string | null = null;
  savingAccountId: string | null = null;

  constructor(private transactionService: TransactionService) {}

  ngOnInit(): void {
    this.loadTransactions();
    this.loadAccounts();
  }

  getIconInfo(t: Transaction) {
    return getTransactionIconInfo(t);
  }

  onIconError(ev: Event) {
    const img = ev.target as HTMLImageElement;
    if (img && !img.src.endsWith('/icons/default.svg')) img.src = '/icons/default.svg';
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
        for (const t of mapped) {
          if (t.id != null) {
            const key = String(t.id);
            this.draftCategoria[key] = t.categoria || '';
            this.draftSubcategoria[key] = t.subcategoria || '';
          }
        }
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

  get uncategorizedTransactions(): Transaction[] {
    return this.transactions
      .filter(t => {
        const cat = (t.categoria || '').toString().trim().toLowerCase();
        // Solo transacciones cuya categoría sea "otro"
        return cat === 'otro' || cat === 'otros';
      })
      .sort((a, b) => (b.dt_date || '').localeCompare(a.dt_date || ''));
  }

  get uncategorizedByMonth(): { monthKey: string; label: string; transactions: Transaction[] }[] {
    const groups = new Map<string, Transaction[]>();
    for (const t of this.uncategorizedTransactions) {
      const dateStr = t.dt_date;
      if (!dateStr) continue;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([monthKey, txs]) => {
        const [yearStr, monthStr] = monthKey.split('-');
        const year = Number(yearStr);
        const month = Number(monthStr) - 1;
        const label = new Date(year, month, 1).toLocaleDateString('es-ES', {
          month: 'long',
          year: 'numeric'
        });
        return { monthKey, label, transactions: txs };
      });
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

  private isOtherCategory(cat: string | undefined | null): boolean {
    const c = (cat || '').toString().trim().toLowerCase();
    return c === 'otro' || c === 'otros';
  }

  /** Grupos para categoría 'Otro' (usado en el bloque superior) */
  get groupedOther(): EditCategoryGroup[] {
    const byCat = new Map<string, Map<string, Transaction[]>>();
    for (const t of this.filteredTransactions.filter(t => this.isOtherCategory(t.categoria))) {
      const cat = t.categoria || 'Otro';
      const sub = t.subcategoria || 'Sin subcategoría';
      if (!byCat.has(cat)) byCat.set(cat, new Map());
      const subMap = byCat.get(cat)!;
      if (!subMap.has(sub)) subMap.set(sub, []);
      subMap.get(sub)!.push(t);
    }
    return Array.from(byCat.entries()).map(([categoria, subMap]) => {
      const subcategories: EditSubcategoryGroup[] = Array.from(subMap.entries()).map(([subcategoria, transactions]) => ({
        subcategoria,
        transactions: transactions.sort((a, b) => (b.dt_date || '').localeCompare(a.dt_date || ''))
      }));
      return {
        categoria,
        subcategories
      };
    });
  }

  /** Grupos para el editor general (todas las categorías excepto 'Otro') */
  get groupedNonOther(): EditCategoryGroup[] {
    const byCat = new Map<string, Map<string, Transaction[]>>();
    for (const t of this.filteredTransactions.filter(t => !this.isOtherCategory(t.categoria))) {
      const cat = t.categoria || 'Sin categoría';
      const sub = t.subcategoria || 'Sin subcategoría';
      if (!byCat.has(cat)) byCat.set(cat, new Map());
      const subMap = byCat.get(cat)!;
      if (!subMap.has(sub)) subMap.set(sub, []);
      subMap.get(sub)!.push(t);
    }
    return Array.from(byCat.entries()).map(([categoria, subMap]) => {
      const subcategories: EditSubcategoryGroup[] = Array.from(subMap.entries()).map(([subcategoria, transactions]) => ({
        subcategoria,
        transactions: transactions.sort((a, b) => (b.dt_date || '').localeCompare(a.dt_date || ''))
      }));
      return {
        categoria,
        subcategories
      };
    });
  }

  getSubcategoriesFor(categoria: string): string[] {
    const key = (categoria || '').toString().trim();
    if (!key) return [];
    const set = new Set<string>();
    for (const t of this.transactions) {
      const c = (t.categoria || '').toString().trim();
      if (c !== key) continue;
      const s = (t.subcategoria || '').toString().trim();
      if (s) set.add(s);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  hasDraftChanges(t: Transaction): boolean {
    if (!t.id) return false;
    const key = String(t.id);
    const currentCat = (t.categoria || '').toString().trim();
    const currentSub = (t.subcategoria || '').toString().trim();
    const draftCat = (this.draftCategoria[key] || '').toString().trim();
    const draftSub = (this.draftSubcategoria[key] || '').toString().trim();
    return currentCat !== draftCat || currentSub !== draftSub;
  }

  openConfirmSave(t: Transaction): void {
    if (!t.id) {
      return;
    }
    const draftKey = String(t.id);
    const categoriaDraft = (this.draftCategoria[draftKey] || '').toString().trim();
    const subcategoriaDraft = (this.draftSubcategoria[draftKey] || '').toString().trim();

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

  private loadAccounts(): void {
    this.accountsLoading = true;
    this.accountsError = null;
    this.transactionService.getAccounts().subscribe({
      next: (res) => {
        const list = res?.data || [];
        this.accounts = list;
        this.accountDraftName = {};
        for (const acc of list) {
          this.accountDraftName[acc.id] = acc.display_name;
        }
        this.accountsLoading = false;
      },
      error: (err) => {
        console.error('[Ajustes] error loadAccounts', err);
        this.accountsError = err.error?.detail || 'Error al cargar cuentas';
        this.accountsLoading = false;
      }
    });
  }

  startEditAccount(acc: Account): void {
    this.editingAccountId = acc.id;
    if (!this.accountDraftName[acc.id]) {
      this.accountDraftName[acc.id] = acc.display_name;
    }
  }

  cancelEditAccount(acc: Account): void {
    this.accountDraftName[acc.id] = acc.display_name;
    if (this.editingAccountId === acc.id) {
      this.editingAccountId = null;
    }
  }

  saveAccountName(acc: Account): void {
    const draft = (this.accountDraftName[acc.id] || '').trim();
    if (!draft || draft === acc.display_name || this.savingAccountId === acc.id) {
      this.editingAccountId = null;
      return;
    }
    this.savingAccountId = acc.id;
    this.transactionService.updateAccountName(acc.id, draft).subscribe({
      next: (res) => {
        acc.display_name = res.display_name || draft;
        this.accountDraftName[acc.id] = acc.display_name;
        this.savingAccountId = null;
        this.editingAccountId = null;
        // Avisar a otras vistas (Resumen, Gastos) para que recarguen si lo desean
        this.transactionService.dataRefresh$.next();
      },
      error: (err) => {
        console.error('[Ajustes] error updateAccountName', err);
        this.accountsError = err.error?.detail || 'Error al guardar nombre de cuenta';
        this.savingAccountId = null;
      }
    });
  }
}
