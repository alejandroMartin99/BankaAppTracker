"""
Detección de transferencias internas entre cuentas propias.
Cuando se detecta: mismo día, mismo importe absoluto, signo opuesto, cuentas distintas
(Revolut, Personal, Conjunta), se marca como transferencia interna para que:
- No afecte a gastos/ingresos/balances
- Se muestre en un apartado dedicado "Transferencias internas"
"""
from typing import Set
from collections import defaultdict

INTERNAL_ACCOUNTS = frozenset({"Revolut", "Personal", "Conjunta"})


def detect_internal_transfer_ids(transactions: list[dict]) -> Set[str]:
    """
    Detecta pares de transferencias internas y retorna los IDs/transaction_ids
    de todas las transacciones que forman parte de un par.

    Criterios: mismo día, mismo importe absoluto, una negativa y otra positiva,
    cuentas distintas dentro de {Revolut, Personal, Conjunta}.
    """
    if not transactions:
        return set()

    def get_id(t: dict) -> str:
        return t.get("transaction_id") or t.get("id") or str(t.get("id", ""))

    def get_date(t: dict) -> str:
        return str(t.get("dt_date") or t.get("transaction_date") or "")

    def get_importe(t: dict) -> float:
        v = t.get("importe") if "importe" in t else t.get("amount")
        try:
            return float(v) if v is not None else 0.0
        except (TypeError, ValueError):
            return 0.0

    def get_cuenta(t: dict) -> str:
        return str(t.get("cuenta") or t.get("account_number") or "").strip()

    matched_ids: Set[str] = set()

    # Agrupar por (fecha, importe_absoluto)
    by_key: dict[tuple[str, float], list[dict]] = defaultdict(list)
    for t in transactions:
        cuenta = get_cuenta(t)
        if cuenta not in INTERNAL_ACCOUNTS:
            continue
        imp = get_importe(t)
        if imp == 0:
            continue
        fecha = get_date(t)
        if not fecha:
            continue
        key = (fecha, abs(round(imp, 2)))
        by_key[key].append(t)

    for (fecha, amount_abs), group in by_key.items():
        negatives = [t for t in group if get_importe(t) < 0]
        positives = [t for t in group if get_importe(t) > 0]
        if not negatives or not positives:
            continue
        # Emparejar: cada negativa con una positiva de cuenta distinta
        used_pos = set()
        for neg in negatives:
            c_neg = get_cuenta(neg)
            for i, pos in enumerate(positives):
                if i in used_pos:
                    continue
                if get_cuenta(pos) != c_neg:
                    matched_ids.add(get_id(neg))
                    matched_ids.add(get_id(pos))
                    used_pos.add(i)
                    break

    return matched_ids
