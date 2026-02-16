import { Transaction } from '../models/transaction.model';

/** Detecta IDs de transferencias internas entre cuentas propias (mismo día, mismo importe, signos opuestos) */
export function detectInternalTransferIds(txs: { dt_date?: string; importe?: number; cuenta?: string; transaction_id?: string; id?: number }[]): Set<string> {
  const INTERNAL_ACCOUNTS = new Set(txs.map(t => (t.cuenta || '').trim()).filter(Boolean));
  const matched = new Set<string>();
  const byKey = new Map<string, typeof txs>();
  for (const t of txs) {
    const cuenta = (t.cuenta || '').trim();
    if (!INTERNAL_ACCOUNTS.has(cuenta)) continue;
    const imp = t.importe ?? 0;
    if (imp === 0) continue;
    const fecha = t.dt_date || '';
    if (!fecha) continue;
    const key = `${fecha}|${Math.abs(Math.round(imp * 100) / 100)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(t);
  }
  for (const [, group] of byKey) {
    const negatives = group.filter(t => (t.importe ?? 0) < 0);
    const positives = group.filter(t => (t.importe ?? 0) > 0);
    if (!negatives.length || !positives.length) continue;
    const usedPos = new Set<number>();
    for (const neg of negatives) {
      const cNeg = (neg.cuenta || '').trim();
      for (let i = 0; i < positives.length; i++) {
        if (usedPos.has(i)) continue;
        if ((positives[i].cuenta || '').trim() !== cNeg) {
          matched.add(neg.transaction_id || String(neg.id || ''));
          matched.add(positives[i].transaction_id || String(positives[i].id || ''));
          usedPos.add(i);
          break;
        }
      }
    }
  }
  return matched;
}
