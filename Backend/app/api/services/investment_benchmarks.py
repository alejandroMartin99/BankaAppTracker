"""
Benchmarks por ISIN usando yfinance (datos vía Yahoo Finance, librería oficial recomendada).
Clasificación contable aproximada: renta variable, renta fija, fondos monetarios.
"""

from __future__ import annotations

import asyncio
import hashlib
import math
import re
import time
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import yfinance as yf

# Selección por defecto (autor) si el usuario no ha guardado ningún ISIN en Supabase
# Cripto en Yahoo (par USD); apartado fijo en la API (no configurable por usuario por ahora)
DEFAULT_CRYPTO_TICKERS: Tuple[str, ...] = ("BTC-USD",)

DEFAULT_AUTHOR_ISINS: Tuple[str, ...] = (
    "FR0000989626",
    "IE00B03HCZ61",
    "IE00B3X1NT05",
    "IE00BYX5P602",
    "IE0032126645",
    "LU0034353002",
    "LU0625737910",
    "LU1048684796",
    "LU1623762843",
)

# Clasificación explícita (Yahoo no siempre expone categoría útil). ISIN nuevos: heurística por nombre.
ISIN_CLASIFICACION: Dict[str, str] = {
    "FR0000989626": "fondos_monetarios",  # Groupama Trésorerie IC
    "IE00B03HCZ61": "renta_variable",  # Vanguard Global Stock Index
    "IE00B3X1NT05": "renta_variable",  # Vanguard Global Small-Cap Index
    "IE00BYX5P602": "renta_variable",  # Fidelity MSCI World
    "IE0032126645": "renta_variable",  # Vanguard U.S. 500 Stock
    "LU0034353002": "renta_fija",  # DWS Floating Rate Notes
    "LU0625737910": "renta_variable",  # Pictet-China Index (RV)
    "LU1048684796": "renta_variable",  # Fidelity Emerging Markets
    "LU1623762843": "renta_fija",  # Carmignac Portfolio Credit
}

# Claves de periodo soportadas por la API (ytd = desde 1 ene; max = histórico completo vía yfinance period=max)
API_PERIODS = frozenset({"ytd", "1m", "6m", "1y", "3y", "5y", "max"})

_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_CACHE_TTL_SEC = 1800.0

_MAX_USER_ISINS = 40
_CACHE_LOCKS: Dict[str, asyncio.Lock] = {}

_ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}\d$")

# Yahoo suele mapear el ISIN a un listado con 0–1 velas (p. ej. FEPE.MU, DI4A.F).
# Clases cotizadas equivalentes con histórico mensual/semanal usable en yfinance.
YAHOO_SYMBOL_BY_ISIN: Dict[str, str] = {
    "IE00BYX5P602": "0P0001CJGV.F",  # Fidelity MSCI World Index (Frankfurt) vs FEPE.MU casi sin datos
    "LU0034353002": "0P00000N4I.F",  # DWS Floating Rate Notes LC vs DI4A.F casi sin datos
}


def max_user_isins() -> int:
    return _MAX_USER_ISINS


def normalize_isin(raw: str) -> str:
    s = raw.strip().upper().replace(" ", "")
    if len(s) != 12 or not _ISIN_RE.match(s):
        raise ValueError("ISIN inválido (12 caracteres: 2 letras país + 9 alfanuméricos + 1 dígito de control)")
    return s


def normalize_isin_list(raw: List[str]) -> List[str]:
    seen: set[str] = set()
    out: List[str] = []
    for x in raw:
        n = normalize_isin(x)
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out


def _cache_key(user_id: str, period: str, isins: List[str]) -> str:
    sig_src = ",".join(isins) + "|" + ",".join(DEFAULT_CRYPTO_TICKERS)
    sig = hashlib.sha256(sig_src.encode()).hexdigest()[:28]
    return f"bench:v8:{user_id}:{period}:{sig}"


def _lock_for_cache_key(key: str) -> asyncio.Lock:
    if key not in _CACHE_LOCKS:
        _CACHE_LOCKS[key] = asyncio.Lock()
    return _CACHE_LOCKS[key]


def _download_history(t: yf.Ticker, period_key: str) -> pd.DataFrame:
    """Histórico según ventana: YTD por fecha inicio (más fiable que period=ytd en fondos)."""
    today = date.today()
    if period_key == "ytd":
        start = date(today.year, 1, 1).isoformat()
        return t.history(start=start, interval="1wk", auto_adjust=True)
    if period_key == "1m":
        return t.history(period="1mo", interval="1d", auto_adjust=True)
    if period_key == "6m":
        return t.history(period="6mo", interval="1wk", auto_adjust=True)
    if period_key == "1y":
        return t.history(period="1y", interval="1mo", auto_adjust=True)
    if period_key == "3y":
        return t.history(period="3y", interval="1mo", auto_adjust=True)
    if period_key == "5y":
        return t.history(period="5y", interval="1mo", auto_adjust=True)
    if period_key == "max":
        return t.history(period="max", interval="1mo", auto_adjust=True)
    return t.history(period="5y", interval="1mo", auto_adjust=True)


def _safe_info_dict(t: yf.Ticker) -> Dict[str, Any]:
    try:
        raw = getattr(t, "info", None)
        if isinstance(raw, dict):
            return raw
    except Exception:
        pass
    return {}


def _history_to_series(hist: pd.DataFrame) -> Tuple[List[str], List[Optional[float]]]:
    if hist is None or hist.empty or "Close" not in hist.columns:
        return [], []
    dates: List[str] = []
    closes: List[Optional[float]] = []
    for idx, val in zip(hist.index, hist["Close"]):
        ts = pd.Timestamp(idx)
        if ts.tzinfo is None:
            ts = ts.tz_localize("UTC")
        else:
            ts = ts.tz_convert("UTC")
        dates.append(ts.strftime("%Y-%m-%d"))
        if val is None or (isinstance(val, float) and math.isnan(val)):
            closes.append(None)
        else:
            closes.append(float(val))
    return dates, closes


def _pct_from_start(closes: List[Optional[float]]) -> List[Optional[float]]:
    first: Optional[float] = None
    for c in closes:
        if c is not None and c > 0:
            first = c
            break
    if first is None:
        return [None] * len(closes)
    pct: List[Optional[float]] = []
    for c in closes:
        if c is None or c <= 0:
            pct.append(None)
        else:
            pct.append(round((c / first - 1.0) * 100.0, 2))
    return pct


def _total_return_pct(closes: List[Optional[float]]) -> Optional[float]:
    vals = [c for c in closes if c is not None and c > 0]
    if len(vals) < 2:
        return None
    a, b = vals[0], vals[-1]
    if a <= 0:
        return None
    return round((b / a - 1.0) * 100.0, 2)


def _norm_name(s: Optional[str], isin: str) -> Optional[str]:
    if not s or not isinstance(s, str):
        return None
    t = s.strip()
    if not t or t.upper() == isin.upper():
        return None
    return t


def _looks_like_yahoo_internal_shortname(s: str) -> bool:
    """Códigos tipo 0P00012L73.F que Yahoo usa como shortName en fondos."""
    u = s.strip().upper()
    if re.match(r"^0P[0-9A-Z]{6,}\.[A-Z0-9]+$", u):
        return True
    if re.match(r"^[A-Z0-9]{10,}\.[A-Z]{1,4}$", u) and " " not in s:
        return True
    return False


def _resolve_fund_name(t: yf.Ticker, isin: str, inf: Dict[str, Any]) -> str:
    """Nombre legible usando metadata Yahoo ya cargada en `inf`."""
    longn = _norm_name(inf.get("longName"), isin)  # type: ignore[arg-type]
    if longn:
        return longn[:160]

    for key in ("displayName", "name"):
        v = _norm_name(inf.get(key), isin)  # type: ignore[arg-type]
        if v:
            return v[:160]

    shortn = _norm_name(inf.get("shortName"), isin)  # type: ignore[arg-type]
    if shortn and not _looks_like_yahoo_internal_shortname(shortn):
        return shortn[:160]

    desc = inf.get("description")
    if isinstance(desc, str):
        chunk = desc.strip().split(". ")
        first = chunk[0].strip() if chunk else ""
        if len(first) > 12:
            v = _norm_name(first, isin)
            if v:
                return v[:160]

    try:
        fi = t.fast_info
        for key in ("longName", "shortName", "name"):
            try:
                raw = fi[key]  # type: ignore[index]
            except (KeyError, TypeError, AttributeError):
                raw = getattr(fi, key, None)
            v = _norm_name(str(raw) if raw is not None else None, isin)
            if not v:
                continue
            if key == "shortName" and _looks_like_yahoo_internal_shortname(v):
                continue
            return v[:160]
    except Exception:
        pass

    return isin


def _clasificar_por_texto(blob: str) -> Optional[str]:
    """Heurística por nombre/categoría cuando no hay ISIN mapeado."""
    u = blob.lower()
    monetarios = (
        "money market",
        "monetario",
        "monetaire",
        "monétaire",
        "trésorerie",
        "tresorerie",
        "treasury ic",
        "liquidity fund",
        "cash fund",
        " overnight",
        "eonia",
        "sonia",
        "sterling overnight",
    )
    for kw in monetarios:
        if kw in u:
            return "fondos_monetarios"

    renta_fija = (
        "floating rate",
        "bond fund",
        " bond",
        "obligacion",
        "obligation",
        "aggregate bond",
        "gov bond",
        "government bond",
        "corporate bond",
        "investment grade",
        "high yield",
        "hy bond",
        "euro credit",
        "euro bond",
        "hg corporate",
        "portfolio credit",
        " pf credit",
        "credit a eur",
        "credit fund",
        "fixed income",
        "renta fija",
        "inflation-linked",
        "mortgage-backed",
        "aggregate ",
        "aggregate-",
        "aggregate euro",
        "aggregate gbp",
        "aggregate usd",
        "notes ucits",
        "notes etf",
    )
    for kw in renta_fija:
        if kw in u:
            return "renta_fija"

    return None


def _clasificacion_activo(isin: str, inf: Dict[str, Any], display_name: str) -> str:
    if isin in ISIN_CLASIFICACION:
        return ISIN_CLASIFICACION[isin]
    parts = [
        display_name or "",
        str(inf.get("longName") or ""),
        str(inf.get("categoryName") or ""),
        str(inf.get("shortName") or ""),
    ]
    blob = " ".join(parts)
    guess = _clasificar_por_texto(blob)
    if guess:
        return guess
    return "renta_variable"


def _fetch_one_isin_sync(isin: str, period_key: str) -> Dict[str, Any]:
    try:
        yahoo_sym = YAHOO_SYMBOL_BY_ISIN.get(isin, isin)
        t = yf.Ticker(yahoo_sym)
        hist = _download_history(t, period_key)
        dates, closes = _history_to_series(hist)
        if not dates:
            return {"isin": isin, "error": "Sin precios en yfinance para este ISIN en el intervalo pedido"}
        inf = _safe_info_dict(t)
        pct_series = _pct_from_start(closes)
        total = _total_return_pct(closes)
        points = []
        for d, p in zip(dates, pct_series):
            if p is not None:
                points.append({"date": d, "pct_vs_start": p})
        sym = getattr(t, "ticker", None) or isin
        name = _resolve_fund_name(t, isin, inf)
        clasificacion = _clasificacion_activo(isin, inf, name)
        return {
            "isin": isin,
            "symbol": str(sym),
            "name": name,
            "clasificacion": clasificacion,
            "total_return_pct": total,
            "points": points,
            "source": "yfinance",
        }
    except Exception as e:
        return {"isin": isin, "error": str(e)[:220]}


def _fetch_crypto_sync(ticker: str, period_key: str) -> Dict[str, Any]:
    """Serie % vs inicio para un par Yahoo (p. ej. BTC-USD)."""
    try:
        t = yf.Ticker(ticker)
        hist = _download_history(t, period_key)
        dates, closes = _history_to_series(hist)
        if not dates:
            return {"symbol": ticker, "error": "Sin precios en yfinance para este activo en el intervalo pedido"}
        inf = _safe_info_dict(t)
        pct_series = _pct_from_start(closes)
        total = _total_return_pct(closes)
        points = []
        for d, p in zip(dates, pct_series):
            if p is not None:
                points.append({"date": d, "pct_vs_start": p})
        sym = getattr(t, "ticker", None) or ticker
        name = _resolve_fund_name(t, ticker, inf)
        return {
            "isin": "",
            "symbol": str(sym),
            "name": name,
            "clasificacion": "criptoactivos",
            "total_return_pct": total,
            "points": points,
            "source": "yfinance",
        }
    except Exception as e:
        return {"symbol": ticker, "error": str(e)[:220]}


def _interval_for_period(period_key: str) -> str:
    if period_key == "ytd":
        return "1wk"
    if period_key == "1m":
        return "1d"
    if period_key in ("1y", "3y", "5y"):
        return "1mo"
    return "1wk"


async def build_benchmarks_payload(period: str, user_id: str, isins: List[str]) -> Dict[str, Any]:
    if period not in API_PERIODS:
        period = "ytd"
    if not isins:
        raise ValueError("Lista de ISIN vacía")
    if len(isins) > _MAX_USER_ISINS:
        raise ValueError(f"Máximo {_MAX_USER_ISINS} ISIN por usuario")
    ck = _cache_key(user_id, period, isins)
    now = time.monotonic()
    hit = _CACHE.get(ck)
    if hit and hit[0] > now:
        return hit[1]

    lock = _lock_for_cache_key(ck)
    async with lock:
        now = time.monotonic()
        hit = _CACHE.get(ck)
        if hit and hit[0] > now:
            return hit[1]

        items: List[Dict[str, Any]] = []
        errors: List[Dict[str, str]] = []
        crypto_items: List[Dict[str, Any]] = []
        crypto_errors: List[Dict[str, str]] = []

        for isin in isins:
            r = await asyncio.to_thread(_fetch_one_isin_sync, isin, period)
            if r.get("error"):
                errors.append({"isin": r["isin"], "detail": r["error"]})
            else:
                items.append(r)
            await asyncio.sleep(0.15)

        for ticker in DEFAULT_CRYPTO_TICKERS:
            r = await asyncio.to_thread(_fetch_crypto_sync, ticker, period)
            if r.get("error"):
                crypto_errors.append({"symbol": r.get("symbol", ticker), "detail": r["error"]})
            else:
                crypto_items.append(r)
            await asyncio.sleep(0.12)

        payload: Dict[str, Any] = {
            "success": True,
            "period": period,
            "range": period,
            "interval": _interval_for_period(period),
            "source": "yfinance",
            "items": items,
            "errors": errors,
            "crypto_items": crypto_items,
            "crypto_errors": crypto_errors,
        }
        _CACHE[ck] = (time.monotonic() + _CACHE_TTL_SEC, payload)
        return payload
