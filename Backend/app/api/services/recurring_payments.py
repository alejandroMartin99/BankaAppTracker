"""
Detección automática de pagos mensuales recurrentes a partir del histórico de gastos.
"""

from __future__ import annotations

import re
import statistics
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from app.api.services.pipe_extract_transactions.internal_transfer_detection import (
    detect_internal_transfer_ids,
)
from app.api.services.supabase.supabase_service import supabase_service

MIN_OCCURRENCES = 3
LOOKBACK_MONTHS = 14
MIN_INTERVAL_DAYS = 25
MAX_INTERVAL_DAYS = 38
MAX_AMOUNT_CV = 0.25
GENERIC_SUBS = frozenset({"", "sin subcategoría", "sin subcategoria", "otros", "other", "n/a"})
EXCLUDE_CATEGORIES = frozenset({"transferencia", "bizum", "nómina", "nomina", "ingresos"})


def _parse_date(raw: Any) -> Optional[date]:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    try:
        if "T" in s:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def _normalize_desc(descripcion: str) -> str:
    s = (descripcion or "").upper().strip()
    s = re.sub(r"\bRECIBO\b", "", s)
    s = re.sub(r"\bTARJETA\b", "", s)
    s = re.sub(r"\bCOMPRA\b", "", s)
    s = re.sub(r"\d{2}[/-]\d{2}[/-]\d{2,4}", " ", s)
    s = re.sub(r"\d+", " ", s)
    s = re.sub(r"[^A-ZÁÉÍÓÚÜÑ\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:80] if s else ""


def _pattern_key_for_tx(tx: Dict[str, Any]) -> Tuple[str, str]:
    """Devuelve (pattern_key, label)."""
    imp = float(tx.get("importe") or 0)
    amount_bucket = round(abs(imp))
    sub = str(tx.get("subcategoria") or "").strip()
    sub_l = sub.lower()
    if sub and sub_l not in GENERIC_SUBS:
        base = re.sub(r"\s+", "_", sub.upper())[:60]
        return f"{base}|{amount_bucket}", sub
    desc = _normalize_desc(str(tx.get("descripcion") or ""))
    if len(desc) >= 4:
        base = re.sub(r"\s+", "_", desc)[:60]
        label = desc.title()[:80]
        return f"{base}|{amount_bucket}", label
    cat = str(tx.get("categoria") or "Gasto").strip()
    return f"{cat}|{amount_bucket}", cat


def _should_exclude_tx(tx: Dict[str, Any], internal_ids: Set[str]) -> bool:
    tid = str(tx.get("transaction_id") or tx.get("id") or "")
    if tid and tid in internal_ids:
        return True
    imp = float(tx.get("importe") or 0)
    if imp >= 0:
        return True
    cat = str(tx.get("categoria") or "").strip().lower()
    if cat in EXCLUDE_CATEGORIES:
        return True
    if cat == "vivienda":
        sub = str(tx.get("subcategoria") or "").lower()
        if "hipoteca" in sub or "hipoteca" in str(tx.get("descripcion") or "").lower():
            return True
    return False


def _amounts_match(a: float, b: float, cv: float) -> bool:
    aa, bb = abs(a), abs(b)
    if aa <= 0 or bb <= 0:
        return False
    tol = 0.12 if cv < 0.12 else 0.25
    return abs(aa - bb) <= max(aa, bb) * tol


def _median_interval_days(dates: List[date]) -> Optional[float]:
    if len(dates) < 2:
        return None
    ordered = sorted(dates)
    gaps = [(ordered[i] - ordered[i - 1]).days for i in range(1, len(ordered))]
    return float(statistics.median(gaps))


def _detect_patterns(expenses: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Agrupa gastos y devuelve patrones mensuales válidos."""
    by_key: Dict[str, List[Dict[str, Any]]] = {}
    labels: Dict[str, str] = {}
    for tx in expenses:
        key, label = _pattern_key_for_tx(tx)
        by_key.setdefault(key, []).append(tx)
        if label and (key not in labels or len(label) > len(labels[key])):
            labels[key] = label

    patterns: List[Dict[str, Any]] = []
    for key, txs in by_key.items():
        if len(txs) < MIN_OCCURRENCES:
            continue
        dates = [_parse_date(t.get("dt_date")) for t in txs]
        dates = [d for d in dates if d]
        if len(dates) < MIN_OCCURRENCES:
            continue
        median_gap = _median_interval_days(dates)
        if median_gap is None or not (MIN_INTERVAL_DAYS <= median_gap <= MAX_INTERVAL_DAYS):
            continue
        amounts = [abs(float(t.get("importe") or 0)) for t in txs]
        if not amounts:
            continue
        mean_a = statistics.mean(amounts)
        if mean_a <= 0:
            continue
        cv = (statistics.pstdev(amounts) / mean_a) if len(amounts) > 1 else 0.0
        if cv > MAX_AMOUNT_CV:
            continue
        days = sorted(d.day for d in dates)
        expected_day = int(statistics.median(days))
        expected_day = max(1, min(28, expected_day))
        last_tx = max(txs, key=lambda t: _parse_date(t.get("dt_date")) or date.min)
        patterns.append(
            {
                "pattern_key": key,
                "label": labels.get(key, key),
                "typical_amount": round(-mean_a, 2),
                "expected_day_of_month": expected_day,
                "amount_cv": round(cv, 4),
                "occurrence_count": len(txs),
                "transactions": txs,
            }
        )
    patterns.sort(key=lambda p: p["label"].lower())
    return patterns


def _month_bounds(month: str) -> Tuple[date, date, str]:
    """month YYYY-MM -> (first day, last day, today iso month)."""
    parts = month.strip().split("-")
    if len(parts) != 2:
        raise ValueError("month debe ser YYYY-MM")
    y, m = int(parts[0]), int(parts[1])
    if m < 1 or m > 12:
        raise ValueError("Mes inválido")
    first = date(y, m, 1)
    last = date(y, m, monthrange(y, m)[1])
    return first, last, month


def _status_for_month(
    pattern: Dict[str, Any],
    month_first: date,
    month_last: date,
    today: date,
) -> Dict[str, Any]:
    cv = float(pattern.get("amount_cv") or 0)
    expected_day = int(pattern["expected_day_of_month"])
    y, m = month_first.year, month_first.month
    last_dom = monthrange(y, m)[1]
    dom = min(expected_day, last_dom)
    expected_date = date(y, m, dom)

    paid_tx: Optional[Dict[str, Any]] = None
    for tx in pattern.get("transactions") or []:
        d = _parse_date(tx.get("dt_date"))
        if not d or d < month_first or d > month_last:
            continue
        if _amounts_match(float(tx.get("importe") or 0), float(pattern["typical_amount"]), cv):
            if paid_tx is None or d > (_parse_date(paid_tx.get("dt_date")) or date.min):
                paid_tx = tx

    if paid_tx:
        pd = _parse_date(paid_tx.get("dt_date"))
        return {
            "status": "paid",
            "expected_date": expected_date.isoformat(),
            "paid_transaction_id": paid_tx.get("id"),
            "paid_date": pd.isoformat() if pd else None,
            "paid_amount": float(paid_tx.get("importe") or 0),
        }

    if today > month_last:
        status = "overdue" if today > expected_date else "pending"
    elif today <= expected_date:
        status = "pending"
    else:
        status = "overdue"

    return {
        "status": status,
        "expected_date": expected_date.isoformat(),
        "paid_transaction_id": None,
        "paid_date": None,
        "paid_amount": None,
    }


def build_recurring_payments_payload(user_id: str, month: Optional[str] = None) -> Dict[str, Any]:
    today = datetime.now(timezone.utc).date()
    if month:
        month_first, month_last, month_str = _month_bounds(month)
    else:
        month_str = today.strftime("%Y-%m")
        month_first = date(today.year, today.month, 1)
        month_last = date(today.year, today.month, monthrange(today.year, today.month)[1])

    from_d = today - timedelta(days=LOOKBACK_MONTHS * 31)
    raw = supabase_service.list_user_transactions(user_id, from_date=from_d.isoformat())
    internal_ids = detect_internal_transfer_ids(raw)
    expenses = [t for t in raw if not _should_exclude_tx(t, internal_ids)]

    dismissed = supabase_service.list_dismissed_recurring_pattern_keys(user_id)
    patterns = [p for p in _detect_patterns(expenses) if p["pattern_key"] not in dismissed]

    items: List[Dict[str, Any]] = []
    for p in patterns:
        st = _status_for_month(p, month_first, month_last, today)
        items.append(
            {
                "pattern_key": p["pattern_key"],
                "label": p["label"],
                "typical_amount": p["typical_amount"],
                "expected_day_of_month": p["expected_day_of_month"],
                "amount_cv": p["amount_cv"],
                "occurrence_count": p["occurrence_count"],
                **st,
            }
        )

    def sort_key(it: Dict[str, Any]) -> Tuple[int, str]:
        order = {"overdue": 0, "pending": 1, "paid": 2}
        return (order.get(it.get("status", ""), 9), it.get("label", ""))

    items.sort(key=sort_key)

    return {
        "success": True,
        "month": month_str,
        "items": items,
        "summary": {
            "paid": sum(1 for i in items if i["status"] == "paid"),
            "pending": sum(1 for i in items if i["status"] == "pending"),
            "overdue": sum(1 for i in items if i["status"] == "overdue"),
            "total": len(items),
        },
    }
