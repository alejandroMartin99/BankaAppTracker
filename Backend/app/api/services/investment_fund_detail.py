"""
Ficha ampliada de fondo/cripto vía yfinance, con caché en Supabase (JSONB por clave).
"""

from __future__ import annotations

import asyncio
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import yfinance as yf

from app.api.services.investment_benchmarks import YAHOO_SYMBOL_BY_ISIN, normalize_isin
from app.api.services.supabase.supabase_service import supabase_service


_INFO_KEYS: frozenset[str] = frozenset(
    {
        "longName",
        "shortName",
        "symbol",
        "isin",
        "quoteType",
        "exchange",
        "fullExchangeName",
        "currency",
        "category",
        "fundFamily",
        "legalType",
        "description",
        "yield",
        "ytdReturn",
        "trailingThreeMonthReturns",
        "annualReportExpenseRatio",
        "annualHoldingsTurnover",
        "totalAssets",
        "fundInceptionDate",
        "morningStarOverallRating",
        "morningStarRiskRating",
        "fiftyTwoWeekHigh",
        "fiftyTwoWeekLow",
        "fiftyTwoWeekChangePercent",
        "regularMarketPrice",
        "previousClose",
        "exchangeTimezoneName",
    }
)

# Evita servir fichas antiguas durante semanas: si supera este umbral, se vuelve a consultar Yahoo.
_FUND_DETAIL_CACHE_MAX_AGE = timedelta(hours=24)


def _json_safe(obj: Any, depth: int = 0) -> Any:
    if depth > 14:
        return None
    if obj is None or isinstance(obj, (bool, str)):
        return obj
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return float(obj)
    if isinstance(obj, int) and not isinstance(obj, bool):
        return int(obj)
    if isinstance(obj, dict):
        return {str(k): _json_safe(v, depth + 1) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v, depth + 1) for v in obj]
    if isinstance(obj, pd.Timestamp):
        return obj.isoformat()
    if isinstance(obj, pd.DataFrame):
        if obj.empty:
            return []
        rec = obj.replace({float("nan"): None}).to_dict(orient="records")
        return _json_safe(rec, depth + 1)
    if isinstance(obj, pd.Series):
        d = obj.replace({float("nan"): None}).to_dict()
        return _json_safe(d, depth + 1)
    if hasattr(obj, "tolist"):
        try:
            return _json_safe(obj.tolist(), depth + 1)
        except Exception:
            pass
    try:
        return str(obj)[:800]
    except Exception:
        return None


def _filter_info(inf: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k, v in inf.items():
        if k not in _INFO_KEYS:
            continue
        out[k] = _json_safe(v)
    return out


def _cache_key(isin: Optional[str], symbol: Optional[str]) -> str:
    if isin:
        return normalize_isin(isin)
    if symbol:
        s = symbol.strip().upper()
        if not s:
            raise ValueError("Símbolo vacío")
        return f"CRYPTO:{s}"
    raise ValueError("Falta isin o symbol")


def _resolve_yahoo_symbol(isin: Optional[str], symbol: Optional[str]) -> str:
    if isin:
        n = normalize_isin(isin)
        return YAHOO_SYMBOL_BY_ISIN.get(n, n)
    if symbol:
        return symbol.strip().upper()
    raise ValueError("Falta isin o symbol")


def _fund_detail_cache_needs_refetch(isin_norm: str, payload: Dict[str, Any], *, for_crypto: bool) -> bool:
    """True si la fila en Supabase no aporta ficha útil (p. ej. Yahoo falló y quedó JSON casi vacío)."""
    inf = payload.get("info")
    if not isinstance(inf, dict) or len(inf) == 0:
        return True
    if for_crypto:
        return False
    from app.api.services.investment_benchmarks import (
        _display_name_from_composition,
        _display_name_from_info_dict,
    )

    if _display_name_from_info_dict(isin_norm, inf):
        return False
    comp = payload.get("composition")
    if isinstance(comp, dict) and _display_name_from_composition(comp, isin_norm):
        return False
    if comp is None:
        return True
    if not isinstance(comp, dict):
        return True
    if (comp.get("composition_error") or "").strip() and not (
        comp.get("top_holdings")
        or comp.get("sector_weightings")
        or (str(comp.get("description") or "")).strip()
    ):
        return True
    return not bool(
        (str(comp.get("description") or "")).strip()
        or comp.get("top_holdings")
        or comp.get("sector_weightings")
        or comp.get("fund_overview")
    )


def _cache_row_is_fresh(updated_at_raw: Any) -> bool:
    if not updated_at_raw:
        return False
    dt: Optional[datetime] = None
    if isinstance(updated_at_raw, datetime):
        dt = updated_at_raw
    elif isinstance(updated_at_raw, str):
        txt = updated_at_raw.strip()
        if txt.endswith("Z"):
            txt = txt[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(txt)
        except Exception:
            dt = None
    if dt is None:
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    age = datetime.now(timezone.utc) - dt.astimezone(timezone.utc)
    return age <= _FUND_DETAIL_CACHE_MAX_AGE


def warm_fund_detail_cache_force_sync(isin: str) -> None:
    """Descarga Yahoo y sobrescribe la ficha en Supabase (p. ej. al añadir ISIN antes de refrescar benchmarks)."""
    if not supabase_service.is_connected():
        return
    try:
        ck = normalize_isin(isin)
    except ValueError:
        return
    ysym = _resolve_yahoo_symbol(ck, None)
    detail = _fetch_fund_detail_sync(ck, ysym)
    supabase_service.upsert_investment_fund_detail_cache(ck, ysym, detail)


def _fetch_fund_detail_sync(cache_key: str, yahoo_symbol: str) -> Dict[str, Any]:
    t = yf.Ticker(yahoo_symbol)
    inf = {}
    try:
        raw = getattr(t, "info", None)
        if isinstance(raw, dict):
            inf = raw
    except Exception:
        pass

    detail: Dict[str, Any] = {
        "yahoo_symbol": yahoo_symbol,
        "cache_key": cache_key,
        "info": _filter_info(inf),
        "composition": None,
        "fund_operations": None,
        "mutualfund_holders": None,
        "composition_error": None,
    }

    # Módulo fondos Yahoo (top holdings, clases de activo, sectores…). Cripto sin este bloque.
    if not cache_key.startswith("CRYPTO:"):
        try:
            fd = t.get_funds_data()
            comp: Dict[str, Any] = {}
            try:
                comp["description"] = str(fd.description or "")[:8000]
            except Exception:
                comp["description"] = ""
            try:
                comp["quote_type"] = fd.quote_type()
            except Exception:
                comp["quote_type"] = ""
            try:
                comp["fund_overview"] = _json_safe(fd.fund_overview)
            except Exception:
                comp["fund_overview"] = {}
            try:
                fo = fd.fund_operations
                comp["fund_operations"] = _json_safe(fo) if fo is not None and not fo.empty else []
            except Exception:
                comp["fund_operations"] = []
            try:
                comp["asset_classes"] = _json_safe(fd.asset_classes)
            except Exception:
                comp["asset_classes"] = {}
            try:
                comp["sector_weightings"] = _json_safe(fd.sector_weightings)
            except Exception:
                comp["sector_weightings"] = {}
            try:
                comp["bond_ratings"] = _json_safe(fd.bond_ratings)
            except Exception:
                comp["bond_ratings"] = {}
            try:
                comp["top_holdings"] = _json_safe(fd.top_holdings)
            except Exception:
                comp["top_holdings"] = []
            try:
                comp["equity_holdings"] = _json_safe(fd.equity_holdings)
            except Exception:
                comp["equity_holdings"] = []
            try:
                comp["bond_holdings"] = _json_safe(fd.bond_holdings)
            except Exception:
                comp["bond_holdings"] = []
            detail["composition"] = comp
        except Exception as e:
            detail["composition_error"] = str(e)[:500]

    try:
        mh = t.mutualfund_holders
        if mh is not None and not mh.empty:
            detail["mutualfund_holders"] = _json_safe(mh)
    except Exception:
        pass

    return detail


async def get_or_build_fund_detail(isin: Optional[str], symbol: Optional[str]) -> Tuple[Dict[str, Any], bool, str]:
    """
    Devuelve (payload_api, from_cache, cache_key).
    payload_api incluye success, detail, updated_at, yahoo_symbol, cached.
    """
    ck = _cache_key(isin, symbol)
    ysym = _resolve_yahoo_symbol(isin, symbol)

    if supabase_service.is_connected():
        row = await asyncio.to_thread(supabase_service.get_investment_fund_detail_cache, ck)
        if row and isinstance(row.get("payload"), dict):
            payload = row["payload"]
            for_crypto = bool(symbol and not isin)
            key_for_name = normalize_isin(isin) if isin else ck
            if _cache_row_is_fresh(row.get("updated_at")) and not _fund_detail_cache_needs_refetch(
                key_for_name, payload, for_crypto=for_crypto
            ):
                return {
                    "success": True,
                    "cached": True,
                    "cache_key": ck,
                    "yahoo_symbol": row.get("yahoo_symbol") or ysym,
                    "updated_at": row.get("updated_at"),
                    "detail": payload,
                }, True, ck

    detail = await asyncio.to_thread(_fetch_fund_detail_sync, ck, ysym)
    now_iso = datetime.now(timezone.utc).isoformat()

    if supabase_service.is_connected():
        await asyncio.to_thread(
            supabase_service.upsert_investment_fund_detail_cache,
            ck,
            ysym,
            detail,
        )

    return {
        "success": True,
        "cached": False,
        "cache_key": ck,
        "yahoo_symbol": ysym,
        "updated_at": now_iso,
        "detail": detail,
    }, False, ck
