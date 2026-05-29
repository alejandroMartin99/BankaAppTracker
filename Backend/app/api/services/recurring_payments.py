"""
Detección automática de cargos e ingresos mensuales recurrentes.
"""

from __future__ import annotations

import logging
import re
import statistics
from collections import Counter
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from app.api.services.pipe_extract_transactions.internal_transfer_detection import (
    detect_internal_transfer_ids,
)
from app.api.services.supabase.supabase_service import supabase_service

logger = logging.getLogger(__name__)

MIN_OCCURRENCES = 2
LOOKBACK_MONTHS = 14
MAX_AMOUNT_CV_DEFAULT = 0.40
MAX_AMOUNT_CV_VARIABLE = 0.60
MAX_AMOUNT_CV_SUBSCRIPTION = 0.80
GENERIC_SUBS = frozenset({"", "sin subcategoría", "sin subcategoria", "otros", "other", "n/a"})
STRUCTURED_CATEGORIES = frozenset({
    "vivienda", "seguros", "suministros", "formación", "formacion", "banco",
    "nómina", "nomina",
})
INCOME_CATEGORIES = frozenset({"nómina", "nomina"})
VARIABLE_AMOUNT_CATEGORIES = frozenset({"suministros", "seguros", "formación", "formacion", "nómina", "nomina"})
EXCLUDE_EXPENSE_CATEGORIES = frozenset({
    "transferencia", "bizum", "nómina", "nomina", "ingresos",
    "supermercado", "restaurantes", "ocio", "ropa", "transporte", "hogar",
    "bienestar", "inversiones",
})
_HOGAR_DESC_RE = re.compile(
    r"IKEA|JYSK|LEROY|AMAZON|ALIEXPRESS|OBRAMAT|HIPERHOGAR|HOGARDEXTER|"
    r"CMB SUPERKIT|RESTANTE MESA",
    re.IGNORECASE,
)
_AGUA_DESC_RE = re.compile(r"AGUA|CANAL DE ISABEL|AQUALIA|EMASESA", re.IGNORECASE)
_LUZ_DESC_RE = re.compile(r"\bLUZ\b|COMERCIALIZADORA|ENERG", re.IGNORECASE)


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


def _cat_slug(cat: str) -> str:
    return re.sub(r"\s+", "_", (cat or "").strip().upper())[:40]


def _cv_limit_for_category(cat_l: str) -> float:
    if cat_l in ("formación", "formacion"):
        return MAX_AMOUNT_CV_SUBSCRIPTION
    if cat_l in VARIABLE_AMOUNT_CATEGORIES:
        return MAX_AMOUNT_CV_VARIABLE
    if cat_l == "vivienda":
        return 0.15
    return MAX_AMOUNT_CV_DEFAULT


def _is_hipoteca_tx(tx: Dict[str, Any]) -> bool:
    cat_l = str(tx.get("categoria") or "").strip().lower()
    sub_l = str(tx.get("subcategoria") or "").strip().lower()
    return cat_l == "vivienda" and sub_l == "hipoteca"


def _is_hipoteca_fallback_tx(tx: Dict[str, Any]) -> bool:
    """
    Fallback estricto por categoría/subcategoría.
    """
    return _is_hipoteca_tx(tx)


def _is_luz_tx(tx: Dict[str, Any]) -> bool:
    cat_l = str(tx.get("categoria") or "").strip().lower()
    sub_l = str(tx.get("subcategoria") or "").strip().lower()
    blob = f"{tx.get('descripcion') or ''} {tx.get('subcategoria') or ''}"
    if cat_l == "suministros" and (sub_l == "luz" or "luz" in sub_l):
        return True
    return bool(_LUZ_DESC_RE.search(blob))


CORE_PATTERN_SPECS: List[Tuple[str, str, str, Callable[[Dict[str, Any]], bool]]] = [
    ("VIVIENDA|HIPOTECA", "Hipoteca", "Vivienda", _is_hipoteca_tx),
    ("SUMINISTROS|LUZ", "Luz", "Suministros", _is_luz_tx),
]
CORE_PATTERN_KEYS = {spec[0] for spec in CORE_PATTERN_SPECS}


def _is_income_candidate(tx: Dict[str, Any]) -> bool:
    if float(tx.get("importe") or 0) <= 0:
        return False
    cat_l = str(tx.get("categoria") or "").strip().lower()
    if cat_l in INCOME_CATEGORIES:
        return True
    sub_u = str(tx.get("subcategoria") or "").upper()
    desc_u = str(tx.get("descripcion") or "").upper()
    return "INDRA" in sub_u or "PLUXEE" in sub_u or "NOMINA" in desc_u or "NÓMINA" in desc_u


def _pattern_key_for_tx(tx: Dict[str, Any]) -> Tuple[str, str]:
    if _is_hipoteca_tx(tx):
        return "VIVIENDA|HIPOTECA", "Hipoteca"
    if _is_luz_tx(tx):
        return "SUMINISTROS|LUZ", "Luz"

    imp = float(tx.get("importe") or 0)
    cat = str(tx.get("categoria") or ("Nómina" if imp > 0 else "")).strip()
    cat_l = cat.lower()
    sub = str(tx.get("subcategoria") or "").strip()
    sub_l = sub.lower()
    cat_part = _cat_slug(cat) or ("NOMINA" if imp > 0 else "GASTO")

    if sub and sub_l not in GENERIC_SUBS:
        sub_part = re.sub(r"\s+", "_", sub.upper())[:50]
        return f"{cat_part}|{sub_part}", sub

    desc_raw = str(tx.get("descripcion") or "")
    if cat_l in STRUCTURED_CATEGORIES or _AGUA_DESC_RE.search(desc_raw):
        desc = _normalize_desc(desc_raw)
        if _AGUA_DESC_RE.search(desc_raw) and "AGUA" not in (desc or ""):
            return f"{cat_part}|AGUA", "Agua"
        if len(desc) >= 4:
            words = desc.split()[:3]
            return f"{cat_part}|{'_'.join(words)}", desc.title()[:80]
        return f"{cat_part}|GENERAL", cat or ("Nómina" if imp > 0 else "Gasto")

    desc = _normalize_desc(desc_raw)
    if len(desc) >= 4:
        words = desc.split()[:3]
        return f"{cat_part}|{'_'.join(words)}", desc.title()[:80]
    return f"{cat_part}|GENERAL", cat or ("Nómina" if imp > 0 else "Gasto")


def _tx_matches_pattern_key(tx: Dict[str, Any], pattern_key: str) -> bool:
    return _pattern_key_for_tx(tx)[0] == pattern_key.strip()


def _is_hogar_purchase(tx: Dict[str, Any]) -> bool:
    cat_l = str(tx.get("categoria") or "").strip().lower()
    if cat_l in ("seguros", "suministros", "vivienda", "formación", "formacion", "nómina", "nomina"):
        return False
    if cat_l == "hogar":
        return True
    blob = f"{tx.get('descripcion') or ''} {tx.get('subcategoria') or ''}"
    return bool(_HOGAR_DESC_RE.search(blob))


def _should_exclude_expense_tx(tx: Dict[str, Any], internal_ids: Set[str]) -> bool:
    # Hipoteca siempre se evalúa como candidata recurrente,
    # incluso si viene con categoría atípica (p.ej. transferencia/banco).
    if _is_hipoteca_tx(tx):
        return False
    tid = str(tx.get("transaction_id") or tx.get("id") or "")
    if tid and tid in internal_ids and not _is_hipoteca_tx(tx):
        return True
    if float(tx.get("importe") or 0) >= 0:
        return True
    cat = str(tx.get("categoria") or "").strip().lower()
    if cat in EXCLUDE_EXPENSE_CATEGORIES:
        return True
    return _is_hogar_purchase(tx)


def _should_exclude_income_tx(tx: Dict[str, Any], internal_ids: Set[str]) -> bool:
    if not _is_income_candidate(tx):
        return True
    tid = str(tx.get("transaction_id") or tx.get("id") or "")
    if tid and tid in internal_ids:
        return True
    cat = str(tx.get("categoria") or "").strip().lower()
    if cat in ("transferencia", "bizum"):
        return True
    return False


def _drop_amount_outliers(txs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if len(txs) < 3:
        return txs
    amounts = [abs(float(t.get("importe") or 0)) for t in txs]
    med = statistics.median(amounts)
    if med <= 0:
        return txs
    return [t for t in txs if abs(float(t.get("importe") or 0)) >= med * 0.22]


def _dedupe_one_per_month(txs: List[Dict[str, Any]], pick_largest: bool = True) -> List[Dict[str, Any]]:
    by_month: Dict[Tuple[int, int], Dict[str, Any]] = {}
    for tx in txs:
        d = _parse_date(tx.get("dt_date"))
        if not d:
            continue
        k = (d.year, d.month)
        cur = by_month.get(k)
        imp = abs(float(tx.get("importe") or 0))
        if cur is None:
            by_month[k] = tx
            continue
        cur_imp = abs(float(cur.get("importe") or 0))
        if (pick_largest and imp > cur_imp) or (not pick_largest and imp < cur_imp):
            by_month[k] = tx
    return list(by_month.values())


def _distinct_month_count(dates: List[date]) -> int:
    return len({(d.year, d.month) for d in dates})


def _is_monthly_cluster(dates: List[date], cat_l: str = "") -> bool:
    if len(dates) < MIN_OCCURRENCES:
        return False
    if _distinct_month_count(dates) < MIN_OCCURRENCES:
        return False
    if cat_l in STRUCTURED_CATEGORIES or cat_l in ("vivienda", "suministros", "seguros"):
        return True
    if len(dates) >= 3:
        ordered = sorted(dates)
        gaps = [(ordered[i] - ordered[i - 1]).days for i in range(1, len(ordered))]
        med = float(statistics.median(gaps))
        if 18 <= med <= 50:
            return True
    return _distinct_month_count(dates) >= MIN_OCCURRENCES


def _amounts_match(a: float, b: float, cv: float) -> bool:
    aa, bb = abs(a), abs(b)
    if aa <= 0 or bb <= 0:
        return False
    tol = 0.15 if cv < 0.15 else (0.30 if cv < 0.45 else 0.45)
    return abs(aa - bb) <= max(aa, bb) * tol


def _build_pattern_record(
    key: str,
    label: str,
    categoria: str,
    txs: List[Dict[str, Any]],
    is_income: bool,
    min_occurrences: int = MIN_OCCURRENCES,
    pick_largest_per_month: bool = True,
) -> Optional[Dict[str, Any]]:
    txs = _dedupe_one_per_month(
        _drop_amount_outliers(txs),
        pick_largest=pick_largest_per_month,
    )
    if len(txs) < min_occurrences:
        return None
    dates = [_parse_date(t.get("dt_date")) for t in txs]
    dates = [d for d in dates if d]
    cat_l = categoria.lower()
    if len(txs) >= MIN_OCCURRENCES and not _is_monthly_cluster(dates, cat_l):
        return None
    amounts = [abs(float(t.get("importe") or 0)) for t in txs]
    if not amounts:
        return None
    mean_a = statistics.mean(amounts)
    if mean_a <= 0:
        return None
    cv = (statistics.pstdev(amounts) / mean_a) if len(amounts) > 1 else 0.0
    if cv > _cv_limit_for_category(cat_l):
        return None
    days = sorted(d.day for d in dates)
    expected_day = max(1, min(28, int(statistics.median(days))))
    signed_amount = round(mean_a, 2) if is_income else round(-mean_a, 2)
    return {
        "pattern_key": key,
        "label": label,
        "categoria": categoria,
        "typical_amount": signed_amount,
        "expected_day_of_month": expected_day,
        "amount_cv": round(cv, 4),
        "occurrence_count": len(txs),
        "transactions": txs,
        "is_income": is_income,
    }


def _detect_patterns(transactions: List[Dict[str, Any]], is_income: bool = False) -> List[Dict[str, Any]]:
    by_key: Dict[str, List[Dict[str, Any]]] = {}
    labels: Dict[str, str] = {}
    for tx in transactions:
        key, label = _pattern_key_for_tx(tx)
        by_key.setdefault(key, []).append(tx)
        if label and (key not in labels or len(label) > len(labels.get(key, ""))):
            labels[key] = label

    patterns: List[Dict[str, Any]] = []
    for key, raw_txs in by_key.items():
        if not is_income and any(_is_hogar_purchase(t) for t in raw_txs):
            continue
        label = labels.get(key, key)
        cat = str(raw_txs[0].get("categoria") or ("Nómina" if is_income else ""))
        if key == "VIVIENDA|HIPOTECA":
            label, cat = "Hipoteca", "Vivienda"
        elif key == "SUMINISTROS|LUZ":
            label, cat = "Luz", "Suministros"
        rec = _build_pattern_record(key, label, cat, raw_txs, is_income)
        if rec:
            patterns.append(rec)
    patterns.sort(key=lambda p: (p.get("categoria") or "", p["label"].lower()))
    return patterns


def _ensure_core_patterns(
    pool: List[Dict[str, Any]],
    patterns: List[Dict[str, Any]],
    dismissed: Set[str],
    is_income: bool,
) -> List[Dict[str, Any]]:
    if is_income:
        return patterns
    existing = {p["pattern_key"] for p in patterns}
    out = list(patterns)
    for key, label, categoria, matcher in CORE_PATTERN_SPECS:
        if key in dismissed or key in existing:
            continue
        txs = [t for t in pool if matcher(t)]
        if key == "VIVIENDA|HIPOTECA" and not txs:
            txs = [t for t in pool if _is_hipoteca_fallback_tx(t)]
        if key == "VIVIENDA|HIPOTECA":
            # Para hipoteca nos interesan solo cargos (importe negativo) y cuota mensual,
            # no transferencias/aportaciones grandes.
            txs = [t for t in txs if float(t.get("importe") or 0) < 0]
        if not txs:
            continue
        rec = _build_pattern_record(
            key,
            label,
            categoria,
            txs,
            is_income=False,
            pick_largest_per_month=(key != "VIVIENDA|HIPOTECA"),
        )
        if not rec and key == "VIVIENDA|HIPOTECA":
            # Fallback: mantener Hipoteca visible aunque solo haya un registro reciente.
            rec = _build_pattern_record(
                key,
                label,
                categoria,
                txs,
                is_income=False,
                min_occurrences=1,
                pick_largest_per_month=False,
            )
        if rec:
            out.append(rec)
            existing.add(key)
    out.sort(key=lambda p: (p.get("categoria") or "", p["label"].lower()))
    return out


def _force_hipoteca_pattern_if_missing(
    pool: List[Dict[str, Any]],
    patterns: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    if any(p.get("pattern_key") == "VIVIENDA|HIPOTECA" for p in patterns):
        return patterns
    txs = [t for t in pool if _is_hipoteca_fallback_tx(t) and float(t.get("importe") or 0) < 0]
    if not txs:
        return patterns
    rec = _build_pattern_record(
        "VIVIENDA|HIPOTECA",
        "Hipoteca",
        "Vivienda",
        txs,
        is_income=False,
        min_occurrences=1,
        pick_largest_per_month=False,
    )
    if not rec:
        return patterns
    out = list(patterns)
    out.append(rec)
    out.sort(key=lambda p: (p.get("categoria") or "", p["label"].lower()))
    return out


def _month_bounds(month: str) -> Tuple[date, date, str]:
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
    is_income = bool(pattern.get("is_income"))
    cv = float(pattern.get("amount_cv") or 0)
    expected_day = int(pattern["expected_day_of_month"])
    y, m = month_first.year, month_first.month
    dom = min(expected_day, monthrange(y, m)[1])
    expected_date = date(y, m, dom)

    paid_tx: Optional[Dict[str, Any]] = None
    typical = float(pattern["typical_amount"])
    for tx in pattern.get("transactions") or []:
        d = _parse_date(tx.get("dt_date"))
        if not d or d < month_first or d > month_last:
            continue
        imp = float(tx.get("importe") or 0)
        if is_income and imp <= 0:
            continue
        if not is_income and imp >= 0:
            continue
        if _amounts_match(imp, typical, cv):
            if paid_tx is None or d > (_parse_date(paid_tx.get("dt_date")) or date.min):
                paid_tx = tx
        elif abs(imp) > 0 and abs(abs(imp) - abs(typical)) <= abs(typical) * (0.45 if cv >= 0.4 else 0.2):
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
            "paid_cuenta": str(paid_tx.get("cuenta") or "") or None,
        }

    return {
        "status": "pending",
        "expected_date": expected_date.isoformat(),
        "paid_transaction_id": None,
        "paid_date": None,
        "paid_amount": None,
    }


def _usual_cuenta(txs: List[Dict[str, Any]]) -> Optional[str]:
    names = [str(t.get("cuenta") or "").strip() for t in txs if str(t.get("cuenta") or "").strip()]
    if not names:
        return None
    return Counter(names).most_common(1)[0][0]


def _load_transaction_pools(user_id: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    today = datetime.now(timezone.utc).date()
    from_d = today - timedelta(days=LOOKBACK_MONTHS * 31)
    own_ids = supabase_service.get_owned_account_ids(user_id)
    shared_ids = supabase_service.get_shared_account_ids(user_id, permission="view")
    visible_account_ids = list(dict.fromkeys(own_ids + shared_ids))
    if not visible_account_ids:
        return [], []

    raw: List[Dict[str, Any]] = []
    try:
        tx_select = "id,transaction_id,dt_date,importe,saldo,descripcion,categoria,subcategoria,account_id,cuenta"
        q = (
            supabase_service.supabase.table("transactions")
            .select(tx_select)
            .in_("account_id", visible_account_ids)
            .gte("dt_date", from_d.isoformat())
            .order("dt_date", desc=False)
            .limit(10000)
        )
        r = q.execute()
        raw = list(r.data or [])
        names = supabase_service.get_account_display_names(visible_account_ids)
        for row in raw:
            row["cuenta"] = names.get(row.get("account_id", ""), row.get("cuenta") or "Cuenta")
    except Exception as e:
        logger.warning("recurring_payments: error cargando transacciones: %s", e, exc_info=True)
        raw = []

    internal_ids = detect_internal_transfer_ids(raw)
    expenses = [t for t in raw if not _should_exclude_expense_tx(t, internal_ids)]
    incomes = [t for t in raw if not _should_exclude_income_tx(t, internal_ids)]
    return expenses, incomes


def _pool_for_pattern(user_id: str) -> List[Dict[str, Any]]:
    expenses, incomes = _load_transaction_pools(user_id)
    return expenses + incomes


def build_recurring_payment_history_payload(user_id: str, pattern_key: str) -> Dict[str, Any]:
    pool = _pool_for_pattern(user_id)
    key = pattern_key.strip()
    raw_txs = [t for t in pool if _tx_matches_pattern_key(t, key)]
    if not raw_txs:
        raise ValueError("Patrón no encontrado")
    is_income = float(raw_txs[0].get("importe") or 0) > 0
    txs = sorted(
        _dedupe_one_per_month(_drop_amount_outliers(raw_txs)),
        key=lambda t: _parse_date(t.get("dt_date")) or date.min,
    )
    label = _pattern_key_for_tx(txs[0])[1]
    if key == "VIVIENDA|HIPOTECA":
        label = "Hipoteca"
    elif key == "SUMINISTROS|LUZ":
        label = "Luz"
    categoria = str(txs[0].get("categoria") or "")
    if key == "VIVIENDA|HIPOTECA":
        categoria = "Vivienda"
    elif key == "SUMINISTROS|LUZ":
        categoria = "Suministros"
    history: List[Dict[str, Any]] = []
    for t in txs:
        d = _parse_date(t.get("dt_date"))
        history.append(
            {
                "date": d.isoformat() if d else None,
                "amount": float(t.get("importe") or 0),
                "cuenta": str(t.get("cuenta") or ""),
                "transaction_id": t.get("id"),
            }
        )
    return {
        "success": True,
        "pattern_key": key,
        "label": label,
        "categoria": categoria,
        "usual_cuenta": _usual_cuenta(txs),
        "is_income": is_income,
        "history": history,
    }


def build_recurring_payments_payload(user_id: str, month: Optional[str] = None) -> Dict[str, Any]:
    today = datetime.now(timezone.utc).date()
    if month:
        month_first, month_last, month_str = _month_bounds(month)
    else:
        month_str = today.strftime("%Y-%m")
        month_first = date(today.year, today.month, 1)
        month_last = date(today.year, today.month, monthrange(today.year, today.month)[1])

    expenses, incomes = _load_transaction_pools(user_id)
    dismissed = supabase_service.list_dismissed_recurring_pattern_keys(user_id)
    # Core patterns nunca deben desaparecer de la vista (Hipoteca/Luz).
    dismissed = {k for k in dismissed if k not in CORE_PATTERN_KEYS}

    patterns = _detect_patterns(expenses, is_income=False)
    patterns = _ensure_core_patterns(expenses, patterns, dismissed, is_income=False)
    patterns = _force_hipoteca_pattern_if_missing(expenses, patterns)
    patterns += _detect_patterns(incomes, is_income=True)
    patterns = [p for p in patterns if p["pattern_key"] not in dismissed]

    items: List[Dict[str, Any]] = []
    for p in patterns:
        st = _status_for_month(p, month_first, month_last, today)
        items.append(
            {
                "pattern_key": p["pattern_key"],
                "label": p["label"],
                "categoria": p.get("categoria"),
                "kind": "income" if p.get("is_income") else "expense",
                "typical_amount": p["typical_amount"],
                "expected_day_of_month": p["expected_day_of_month"],
                "amount_cv": p["amount_cv"],
                "occurrence_count": p["occurrence_count"],
                "usual_cuenta": _usual_cuenta(p.get("transactions") or []),
                "paid_cuenta": st.get("paid_cuenta"),
                **{k: v for k, v in st.items() if k != "paid_cuenta"},
            }
        )

    def sort_key(it: Dict[str, Any]) -> Tuple[int, str, str]:
        kind_order = 0 if it.get("kind") == "income" else 1
        status_order = {"pending": 0, "paid": 1}
        return (kind_order, status_order.get(it.get("status", ""), 9), it.get("label", ""))

    items.sort(key=sort_key)

    return {
        "success": True,
        "month": month_str,
        "items": items,
        "summary": {
            "paid": sum(1 for i in items if i["status"] == "paid"),
            "pending": sum(1 for i in items if i["status"] == "pending"),
            "overdue": 0,
            "total": len(items),
        },
    }
