import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Transaction } from '../../models/transaction.model';
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
  styleUrl: './ajustes.component.scss'
})
export class AjustesComponent implements OnInit {
  transactions: Transaction[] = [];
  loading = false;
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

  constructor(private transactionService: TransactionService) {}

  ngOnInit(): void {
    this.loadTransactions();
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

  get groupedFiltered(): EditCategoryGroup[] {
    const byCat = new Map<string, Map<string, Transaction[]>>();
    for (const t of this.filteredTransactions) {
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
}
