"""
Benchmarks por ISIN usando yfinance (datos vía Yahoo Finance, librería oficial recomendada).
Clasificación contable aproximada: renta variable, renta fija, fondos monetarios.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import re
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from app.core.config import settings

logger = logging.getLogger(__name__)

_benchmark_refresh_lock = asyncio.Lock()

import pandas as pd
import yfinance as yf

from app.api.services.supabase.supabase_service import supabase_service

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
    "IE00B4ND3602": "renta_variable",  # iShares Physical Gold ETC
}

# Nombres legibles si Yahoo no devuelve metadata (p. ej. IP de datacenter bloqueada en deploy).
# Debe cubrir al menos los ISIN de ISIN_CLASIFICACION / lista por defecto.
ISIN_FALLBACK_LABEL: Dict[str, str] = {
    "FR0000989626": "Groupama Trésorerie IC",
    "IE00B03HCZ61": "Vanguard Global Stock Index",
    "IE00B3X1NT05": "Vanguard Global Small-Cap Index",
    "IE00BYX5P602": "Fidelity MSCI World Index",
    "IE0032126645": "Vanguard U.S. 500 Stock Index",
    "LU0034353002": "DWS Floating Rate Notes LC",
    "LU0625737910": "Pictet-China Index",
    "LU1048684796": "Fidelity Emerging Markets",
    "LU1623762843": "Carmignac Portfolio Credit",
    "ES0165243025": "Myinvestor Value FI",
    "IE00B4ND3602": "iShares Physical Gold ETC",
}

# Claves de periodo soportadas por la API (el servidor devuelve ~5y en caché; el cliente filtra la ventana).
API_PERIODS = frozenset({"ytd", "1m", "6m", "1y", "3y", "5y"})

# Histórico guardado en Supabase (yfinance); el cliente filtra ventana en memoria.
# 5y en diario: YTD y 1M muestran curva diaria (antes 1wk/1mo dejaban YTD casi vacío).
STORE_HORIZON_PERIOD = "5y"

_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_CACHE_TTL_SEC = 1800.0
# Lecturas Supabase: TTL por defecto cuando el payload es bueno.
_BENCHMARK_GET_CACHE_TTL_SEC = 45.0
# Si hubo fallos (p. ej. caché aún no poblada), no congelar ese resultado mucho tiempo en RAM.
_BENCHMARK_GET_CACHE_TTL_SOFT_FAIL_SEC = 3.0
_BENCHMARK_GET_CACHE_TTL_PARTIAL_ERR_SEC = 12.0


def crypto_instrument_key(ticker: str) -> str:
    return f"CRYPTO:{ticker.strip().upper()}"

_MAX_USER_ISINS = 40
_CACHE_LOCKS: Dict[str, asyncio.Lock] = {}

_ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}\d$")

# Yahoo suele mapear el ISIN a un listado con 0–1 velas (p. ej. FEPE.MU, DI4A.F).
# Clases cotizadas equivalentes con histórico mensual/semanal usable en yfinance.
YAHOO_SYMBOL_BY_ISIN: Dict[str, str] = {
    "IE00BYX5P602": "0P0001CJGV.F",  # Fidelity MSCI World Index (Frankfurt) vs FEPE.MU casi sin datos
    "LU0034353002": "0P00000N4I.F",  # DWS Floating Rate Notes LC vs DI4A.F casi sin datos
    "IE00B4ND3602": "SGLN.L",  # iShares Physical Gold ETC (LSE); el ISIN solo suele dar poca historia
}

# Typos frecuentes (8/O, B/8) → ISIN canónico con caché Yahoo
ISIN_CANONICAL_ALIASES: Dict[str, str] = {
    "IE0084ND3602": "IE00B4ND3602",  # iShares Physical Gold: 084 vs B4ND
}


def max_user_isins() -> int:
    return _MAX_USER_ISINS


def normalize_isin(raw: str) -> str:
    s = raw.strip().upper().replace(" ", "")
    if len(s) != 12 or not _ISIN_RE.match(s):
        raise ValueError("ISIN inválido (12 caracteres: 2 letras país + 9 alfanuméricos + 1 dígito de control)")
    return s


def canonical_isin(raw: str) -> str:
    """ISIN normalizado; corrige alias conocidos (p. ej. oro IE0084… → IE00B4…)."""
    n = normalize_isin(raw)
    return ISIN_CANONICAL_ALIASES.get(n, n)


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
    return f"bench:v9:{user_id}:{period}:{sig}"


def _lock_for_cache_key(key: str) -> asyncio.Lock:
    if key not in _CACHE_LOCKS:
        _CACHE_LOCKS[key] = asyncio.Lock()
    return _CACHE_LOCKS[key]


def _history_5y_preferred_daily(t: yf.Ticker) -> pd.DataFrame:
    df = t.history(period="5y", interval="1d", auto_adjust=True)
    if df is None or df.empty:
        df = t.history(period="5y", interval="1wk", auto_adjust=True)
    return df


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
        return _history_5y_preferred_daily(t)
    return _history_5y_preferred_daily(t)


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
        # Calendario del propio huso del índice (p. ej. Europe/Madrid). Si pasamos a UTC, un cierre
        # "2021-04-15+02" pasa a "2021-04-14" y el recorte del front excluye el primer cierre → % bajo.
        dates.append(ts.strftime("%Y-%m-%d"))
        if val is None or (isinstance(val, float) and math.isnan(val)):
            closes.append(None)
        else:
            closes.append(float(val))
    return dates, closes


# Salto imposible entre dos cierres consecutivos (corrupto / split mal). No limita el % acumulado vs el
# primer día del periodo: ese puede ser >>100% o <<-100% en teoría con apalancamiento; con NAV spot >0
# el suelo práctico es -100% respecto al primer cierre.
_NAV_BAR_MIN_STEP_RATIO = 0.008
_NAV_BAR_MAX_STEP_RATIO = 30.0


def _sort_nav_bars_by_date(bars: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Cronológico ascendente; si no, el «primer» cierre del array puede ser el más reciente y el % acumulado queda invertido."""
    return sorted(bars, key=lambda r: str(r.get("date") or ""))


def _nav_bars_from_hist(hist: pd.DataFrame) -> List[Dict[str, Any]]:
    dates, closes = _history_to_series(hist)
    bars: List[Dict[str, Any]] = []
    for d, c in zip(dates, closes):
        if c is not None and c > 0:
            bars.append({"date": d, "close": round(float(c), 6)})
    return _sanitize_nav_bars(_sort_nav_bars_by_date(bars))


def _sanitize_nav_bars(bars: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Elimina cierres aberrantes (splits/errores Yahoo) repitiendo el último cierre válido."""
    if len(bars) < 2:
        return bars
    out: List[Dict[str, Any]] = []
    prev = float(bars[0]["close"])
    out.append({"date": bars[0]["date"], "close": round(prev, 6)})
    for i in range(1, len(bars)):
        raw = float(bars[i]["close"])
        use = raw
        if prev > 0:
            ratio = raw / prev
            if ratio < _NAV_BAR_MIN_STEP_RATIO or ratio > _NAV_BAR_MAX_STEP_RATIO:
                use = prev
        if use > 0:
            prev = use
        out.append({"date": bars[i]["date"], "close": round(float(use), 6)})
    return out


def _sanitize_close_list(closes: List[Optional[float]]) -> List[Optional[float]]:
    """Filtra cierres con saltos imposibles (misma heurística que `_sanitize_nav_bars`)."""
    out: List[Optional[float]] = []
    prev: Optional[float] = None
    for c in closes:
        if c is None:
            out.append(None)
            continue
        try:
            cf = float(c)
        except (TypeError, ValueError):
            out.append(None)
            continue
        if math.isnan(cf) or cf <= 0:
            out.append(None)
            continue
        if prev is None or prev <= 0:
            out.append(cf)
            prev = cf
            continue
        r = cf / prev
        if r < _NAV_BAR_MIN_STEP_RATIO or r > _NAV_BAR_MAX_STEP_RATIO:
            out.append(prev)
        else:
            out.append(cf)
            prev = cf
    return out


def _coerce_and_sanitize_cached_nav_bars(nb: List[Any]) -> List[Dict[str, Any]]:
    """Normaliza filas JSONB y aplica el mismo filtro de outliers que en descarga yfinance."""
    bars: List[Dict[str, Any]] = []
    for x in nb:
        if not isinstance(x, dict):
            continue
        d = x.get("date")
        c = x.get("close")
        if d is None or c is None:
            continue
        try:
            cf = float(c)
        except (TypeError, ValueError):
            continue
        if cf > 0:
            bars.append({"date": str(d), "close": round(cf, 6)})
    return _sanitize_nav_bars(_sort_nav_bars_by_date(bars))


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


def _usable_display_string(raw: Optional[Any], isin: str) -> Optional[str]:
    """Igual que _norm_name pero descarta códigos internos Yahoo (a veces en longName/name)."""
    if raw is None:
        return None
    if not isinstance(raw, str):
        try:
            raw = str(raw)
        except Exception:
            return None
    v = _norm_name(raw, isin)
    if not v:
        return None
    if _looks_like_yahoo_internal_shortname(v):
        return None
    return v


def _display_name_from_info_dict(isin: str, inf: Dict[str, Any]) -> Optional[str]:
    """Nombre legible solo a partir del dict `info` (sin fast_info)."""
    if not inf:
        return None
    inv = isin.strip().upper()
    for key in ("longName", "displayName", "name", "shortName"):
        v = _usable_display_string(inf.get(key), isin)
        if v:
            return v

    # fundFamily suele ser la SGIIC/gestora (p. ej. Andbank), no el nombre comercial del fondo.
    fb = ISIN_FALLBACK_LABEL.get(inv)
    if fb:
        return fb[:160]

    desc = inf.get("description")
    if isinstance(desc, str):
        chunk = desc.strip().split(". ")
        first = chunk[0].strip() if chunk else ""
        if len(first) > 12:
            v = _usable_display_string(first, isin)
            if v:
                return v

    ff = _usable_display_string(inf.get("fundFamily"), isin)
    cat = _usable_display_string(inf.get("category"), isin)
    if ff and cat and ff.lower() != cat.lower():
        combo = f"{ff} ({cat})"
        if combo:
            return combo[:160]
    if ff:
        return ff[:160]
    return None


def _display_name_from_composition(comp: Dict[str, Any], isin: str) -> Optional[str]:
    """Nombre desde composición (fund_overview / descripción) cuando `info` solo trae ticker interno."""
    fo = comp.get("fund_overview")
    if isinstance(fo, dict):
        for key in (
            "Fund Name",
            "Name",
            "Legal Name",
            "Fund legal name",
            "Fund Name (Legal)",
            "longName",
        ):
            v = _usable_display_string(fo.get(key), isin)
            if v:
                return v
        for raw in fo.values():
            v = _usable_display_string(raw, isin) if isinstance(raw, str) else None
            if v and len(v) >= 10 and " " in v:
                return v
    d = comp.get("description")
    if isinstance(d, str) and d.strip():
        first = d.strip().split(". ")[0].strip()
        v = _usable_display_string(first, isin)
        if v and len(first) > 12:
            return v
    return None


def _resolve_display_name_from_detail_payload(isin: str, pl: Dict[str, Any]) -> Optional[str]:
    """Nombre legible desde payload de ficha (info + composition + catálogo interno)."""
    if not isinstance(pl, dict):
        return None
    inv = isin.strip().upper()
    inf = pl.get("info") if isinstance(pl.get("info"), dict) else {}
    hit = _display_name_from_info_dict(isin, inf)
    if hit:
        return hit[:160]

    fb = ISIN_FALLBACK_LABEL.get(inv)
    if fb:
        return fb[:160]

    desc = inf.get("description") if isinstance(inf, dict) else None
    if isinstance(desc, str):
        first = desc.strip().split(". ")[0].strip()
        v = _usable_display_string(first, isin)
        if v and len(first) > 12:
            return v[:160]

    comp = pl.get("composition")
    if isinstance(comp, dict):
        hit = _display_name_from_composition(comp, isin)
        if hit:
            return hit[:160]

    if isinstance(inf, dict):
        ff = _usable_display_string(inf.get("fundFamily"), isin)
        cat = _usable_display_string(inf.get("category"), isin)
        if ff and cat and ff.lower() != cat.lower():
            combo = f"{ff} ({cat})"
            if combo.upper() != inv:
                return combo[:160]
        if ff:
            return ff[:160]
    return None


def _name_from_fund_detail_supabase_cache(isin: str) -> Optional[str]:
    """Si existe ficha en caché (p. ej. otro request con Yahoo respondiendo), reutiliza longName o descripción del fondo."""
    try:
        if not supabase_service.is_connected():
            return None
        row = supabase_service.get_investment_fund_detail_cache(isin.strip().upper())
        if not row or not isinstance(row.get("payload"), dict):
            return None
        return _resolve_display_name_from_detail_payload(isin, row["payload"])
    except Exception:
        return None


def discover_yahoo_symbol_for_isin(isin: str) -> str:
    """
    Resuelve símbolo Yahoo para un ISIN sin mapa manual obligatorio.
    Orden: override interno → caché ficha → metadata Yahoo del ISIN → búsqueda yfinance.
    """
    inv = canonical_isin(isin)
    if inv in YAHOO_SYMBOL_BY_ISIN:
        return YAHOO_SYMBOL_BY_ISIN[inv]

    if supabase_service.is_connected():
        row = supabase_service.get_investment_fund_detail_cache(inv)
        if row:
            ysym = str(row.get("yahoo_symbol") or "").strip()
            if ysym and ysym.upper() != inv:
                return ysym

    try:
        inf = _safe_info_dict(yf.Ticker(inv))
        for key in ("symbol", "exchange", "quoteType"):
            _ = inf.get(key)
        sym = inf.get("symbol")
        if isinstance(sym, str) and sym.strip() and sym.strip().upper() != inv:
            return sym.strip()
    except Exception:
        pass

    try:
        from yfinance import Search

        hits = Search(inv, max_results=8).quotes or []
        for q in hits:
            if not isinstance(q, dict):
                continue
            sym = str(q.get("symbol") or "").strip()
            if not sym or sym.upper() == inv:
                continue
            q_isin = str(q.get("isin") or q.get("isinCode") or "").strip().upper()
            if q_isin == inv:
                return sym
        for q in hits:
            if not isinstance(q, dict):
                continue
            sym = str(q.get("symbol") or "").strip()
            if sym and sym.upper() != inv:
                return sym
    except Exception:
        pass

    return inv


def sync_benchmark_name_from_fund_detail_isin(isin: str) -> None:
    """Propaga el nombre legible de la ficha en caché al payload de benchmark (si aún muestra ISIN)."""
    if not supabase_service.is_connected():
        return
    inv = canonical_isin(isin)
    resolved = _name_from_fund_detail_supabase_cache(inv)
    if not resolved or resolved.upper() == inv:
        return
    rows = supabase_service.get_investment_benchmark_series_batch([inv])
    pl = rows.get(inv)
    if not isinstance(pl, dict):
        return
    current = str(pl.get("name") or "").strip()
    if (
        current
        and current.upper() != inv
        and not _looks_like_yahoo_internal_shortname(current)
    ):
        return
    patched = dict(pl)
    patched["name"] = resolved[:160]
    ysym = str(patched.get("symbol") or inv)
    supabase_service.upsert_investment_benchmark_series(inv, ysym, patched)


def _resolve_benchmark_display_name(isin: str, pl: Dict[str, Any]) -> str:
    """Nombre para UI (detalle/gráfico): evita mostrar solo el ISIN si hay ficha o etiqueta de respaldo."""
    inv = isin.strip().upper()
    raw = str(pl.get("name") or "").strip()
    name_unusable = (
        not raw
        or raw.upper() == inv
        or _looks_like_yahoo_internal_shortname(raw)
    )
    if name_unusable:
        alt = _name_from_fund_detail_supabase_cache(inv)
        if alt:
            return alt[:160]
        fb = ISIN_FALLBACK_LABEL.get(inv)
        if fb:
            return fb
        return raw or inv
    return raw[:160]


def _resolve_fund_name(t: yf.Ticker, isin: str, inf: Dict[str, Any]) -> str:
    """Nombre legible usando metadata Yahoo ya cargada en `inf`."""
    v = _display_name_from_info_dict(isin, inf)
    if v:
        return v[:160]

    try:
        fi = t.fast_info
        for key in ("longName", "shortName", "name"):
            try:
                raw = fi[key]  # type: ignore[index]
            except (KeyError, TypeError, AttributeError):
                raw = getattr(fi, key, None)
            v = _usable_display_string(str(raw) if raw is not None else None, isin)
            if not v:
                continue
            return v[:160]
    except Exception:
        pass

    try:
        fd = t.get_funds_data()
        desc = str(getattr(fd, "description", None) or "")
        if desc.strip():
            first = desc.strip().split(". ")[0].strip()
            v = _usable_display_string(first, isin)
            if v and len(first) > 12:
                return v[:160]
    except Exception:
        pass

    inv = isin.strip().upper()
    fb = ISIN_FALLBACK_LABEL.get(inv)
    if fb:
        return fb[:160]

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
        yahoo_sym = discover_yahoo_symbol_for_isin(isin)
        t = yf.Ticker(yahoo_sym)
        hist = _download_history(t, period_key)
        dates, closes = _history_to_series(hist)
        closes = _sanitize_close_list(closes)
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
        if name == isin:
            cached_nm = _name_from_fund_detail_supabase_cache(isin)
            if cached_nm:
                name = cached_nm
        if name == isin:
            name = ISIN_FALLBACK_LABEL.get(isin, isin)
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
        closes = _sanitize_close_list(closes)
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


def _build_isin_nav_cache_row_sync(
    isin: str, period_key: str = STORE_HORIZON_PERIOD
) -> Dict[str, Any]:
    """Serie de cierres para guardar en Supabase (no incluye `instrument_key` de fila)."""
    isin = canonical_isin(isin)
    try:
        yahoo_sym = discover_yahoo_symbol_for_isin(isin)
        t = yf.Ticker(yahoo_sym)
        hist = _download_history(t, period_key)
        nav_bars = _nav_bars_from_hist(hist)
        if not nav_bars:
            return {"isin": isin, "error": "Sin precios en yfinance para este ISIN en el intervalo pedido"}
        inf = _safe_info_dict(t)
        name = _resolve_fund_name(t, isin, inf)
        if name == isin:
            cached_nm = _name_from_fund_detail_supabase_cache(isin)
            if cached_nm:
                name = cached_nm
        if name == isin:
            name = ISIN_FALLBACK_LABEL.get(isin, isin)
        clasificacion = _clasificacion_activo(isin, inf, name)
        sym = getattr(t, "ticker", None) or isin
        return {
            "isin": isin,
            "symbol": str(sym),
            "name": name,
            "clasificacion": clasificacion,
            "nav_bars": nav_bars,
            "source": "yfinance",
        }
    except Exception as e:
        return {"isin": isin, "error": str(e)[:220]}


def _build_crypto_nav_cache_row_sync(
    ticker: str, period_key: str = STORE_HORIZON_PERIOD
) -> Dict[str, Any]:
    try:
        t = yf.Ticker(ticker)
        hist = _download_history(t, period_key)
        nav_bars = _nav_bars_from_hist(hist)
        if not nav_bars:
            return {"symbol": ticker, "error": "Sin precios en yfinance para este activo en el intervalo pedido"}
        inf = _safe_info_dict(t)
        name = _resolve_fund_name(t, ticker, inf)
        sym = getattr(t, "ticker", None) or ticker
        return {
            "isin": "",
            "symbol": str(sym),
            "name": name,
            "clasificacion": "criptoactivos",
            "nav_bars": nav_bars,
            "source": "yfinance",
        }
    except Exception as e:
        return {"symbol": ticker, "error": str(e)[:220]}


def collect_refresh_instrument_keys() -> List[str]:
    keys: set[str] = set(DEFAULT_AUTHOR_ISINS)
    if supabase_service.is_connected():
        for isin in supabase_service.list_distinct_investment_isins():
            keys.add(canonical_isin(isin))
    for t in DEFAULT_CRYPTO_TICKERS:
        keys.add(crypto_instrument_key(t))
    return sorted(keys)


def refresh_instrument_keys_sync(keys: List[str]) -> None:
    """Descarga yfinance y escribe Supabase para cada clave (ISIN o CRYPTO:…)."""
    if not supabase_service.is_connected():
        print("[benchmark-cache] Supabase no conectado; se omite refresco")
        return
    seen: set[str] = set()
    for raw_key in keys:
        key = (raw_key or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        if key.startswith("CRYPTO:"):
            ticker = key.split(":", 1)[1].strip()
            if not ticker:
                continue
            pl = _build_crypto_nav_cache_row_sync(ticker, STORE_HORIZON_PERIOD)
            if pl.get("error"):
                print(f"[benchmark-cache] {key}: {pl.get('error')}")
                continue
            ysym = str(pl.get("symbol") or ticker)
            supabase_service.upsert_investment_benchmark_series(key, ysym, pl)
        else:
            ck = canonical_isin(key)
            pl = _build_isin_nav_cache_row_sync(ck, STORE_HORIZON_PERIOD)
            if pl.get("error"):
                print(f"[benchmark-cache] {key}: {pl.get('error')}")
                continue
            ysym = str(pl.get("symbol") or ck)
            supabase_service.upsert_investment_benchmark_series(ck, ysym, pl)
            sync_benchmark_name_from_fund_detail_isin(ck)


def run_refresh_investment_benchmark_cache() -> None:
    refresh_instrument_keys_sync(collect_refresh_instrument_keys())


def should_refresh_investment_benchmark_cache() -> bool:
    """True si la caché está vacía o el último refresco en Supabase fue hace >= intervalo configurado."""
    if not supabase_service.is_connected():
        return False
    latest = supabase_service.get_latest_benchmark_cache_updated_at()
    if latest is None:
        return True
    interval = timedelta(hours=float(settings.INVESTMENT_BENCHMARK_REFRESH_INTERVAL_HOURS))
    return datetime.now(timezone.utc) - latest >= interval


def _keys_for_benchmark_view(isins: List[str]) -> List[str]:
    """ISIN visibles en Inversión + cripto fija (sin repetir)."""
    seen: set[str] = set()
    out: List[str] = []
    for raw in isins:
        try:
            ck = canonical_isin(raw)
        except ValueError:
            continue
        if ck not in seen:
            seen.add(ck)
            out.append(ck)
    for t in DEFAULT_CRYPTO_TICKERS:
        ck = crypto_instrument_key(t)
        if ck not in seen:
            seen.add(ck)
            out.append(ck)
    return out


def _invalidate_benchmark_get_cache(user_id: str, isins: List[str]) -> None:
    ck = _cache_key(user_id, "supabase_full", isins)
    _CACHE.pop(ck, None)


def should_refresh_benchmarks_for_view() -> bool:
    """True si toca refrescar al abrir Inversión (intervalo 8h o cambio de día UTC)."""
    if should_refresh_investment_benchmark_cache():
        return True
    if not supabase_service.is_connected():
        return False
    latest = supabase_service.get_latest_benchmark_cache_updated_at()
    if latest is None:
        return True
    now = datetime.now(timezone.utc)
    return latest.astimezone(timezone.utc).date() < now.date()


async def maybe_refresh_benchmarks_for_view(isins: List[str], reason: str = "inversion-view") -> bool:
    """
    Refresco bajo demanda al abrir Inversión: solo los ISIN del usuario + cripto.
    Respeta el intervalo global salvo que la caché esté vacía.
    """
    if not settings.INVESTMENT_BENCHMARK_REFRESH_IN_APP:
        return False
    if not supabase_service.is_connected():
        logger.info("[benchmark-cache] omitido (%s): Supabase no conectado", reason)
        return False
    keys = _keys_for_benchmark_view(isins)
    if not keys:
        return False
    async with _benchmark_refresh_lock:
        if not should_refresh_benchmarks_for_view():
            latest = supabase_service.get_latest_benchmark_cache_updated_at()
            logger.info(
                "[benchmark-cache] omitido (%s): último refresco %s (intervalo %.1fh)",
                reason,
                latest.isoformat() if latest else "nunca",
                settings.INVESTMENT_BENCHMARK_REFRESH_INTERVAL_HOURS,
            )
            return False
        logger.info("[benchmark-cache] iniciando (%s) claves=%d", reason, len(keys))
        await asyncio.to_thread(refresh_instrument_keys_sync, keys)
        logger.info("[benchmark-cache] terminado (%s)", reason)
        return True


async def maybe_refresh_investment_benchmark_cache(reason: str, *, force: bool = False) -> bool:
    """
    Refresco al despertar/arranque: solo si pasaron >= N horas desde el último updated_at en Supabase.
    `force=True` ignora el intervalo (p. ej. endpoint manual con secreto).
    """
    if not settings.INVESTMENT_BENCHMARK_REFRESH_IN_APP and not force:
        return False
    if not supabase_service.is_connected():
        logger.info("[benchmark-cache] omitido (%s): Supabase no conectado", reason)
        return False
    async with _benchmark_refresh_lock:
        if not force and not should_refresh_investment_benchmark_cache():
            latest = supabase_service.get_latest_benchmark_cache_updated_at()
            logger.info(
                "[benchmark-cache] omitido (%s): último refresco %s (intervalo %.1fh)",
                reason,
                latest.isoformat() if latest else "nunca",
                settings.INVESTMENT_BENCHMARK_REFRESH_INTERVAL_HOURS,
            )
            return False
        logger.info("[benchmark-cache] iniciando (%s)", reason)
        await asyncio.to_thread(run_refresh_investment_benchmark_cache)
        logger.info("[benchmark-cache] terminado (%s)", reason)
        return True


def _nav_bars_from_cached_payload(pl: Any) -> Optional[List[Any]]:
    """`nav_bars` en JSONB (snake o camel); None si no hay serie usable."""
    if not isinstance(pl, dict):
        return None
    nb = pl.get("nav_bars")
    if isinstance(nb, list) and len(nb) > 0:
        return nb
    nb = pl.get("navBars")
    if isinstance(nb, list) and len(nb) > 0:
        return nb
    return None


def _build_benchmarks_payload_from_supabase_sync(user_id: str, isins: List[str]) -> Dict[str, Any]:
    """Lee solo Supabase: items con `nav_bars` (horizonte STORE); sin yfinance."""
    _ = user_id
    if not supabase_service.is_connected():
        raise RuntimeError("Supabase no disponible")
    keys_needed: List[str] = []
    for isin in isins:
        keys_needed.append(canonical_isin(isin))
    for t in DEFAULT_CRYPTO_TICKERS:
        keys_needed.append(crypto_instrument_key(t))
    rows = supabase_service.get_investment_benchmark_series_batch(keys_needed)
    if len(rows) == 0 and len(keys_needed) > 0:
        time.sleep(0.25)
        rows = supabase_service.get_investment_benchmark_series_batch(keys_needed)
    items: List[Dict[str, Any]] = []
    errors: List[Dict[str, str]] = []
    for isin in isins:
        ck = canonical_isin(isin)
        pl = rows.get(ck)
        nb_raw = _nav_bars_from_cached_payload(pl)
        if not nb_raw:
            detail = "Sin datos en caché. El refresco automático puede tardar unos minutos tras desplegar."
            if ck != str(isin).strip().upper():
                detail = (
                    f"Sin datos en caché para {isin}. El ISIN corregido es {ck}; "
                    "quita el ISIN erróneo y añade el correcto, o espera al refresco automático."
                )
            errors.append({"isin": isin, "detail": detail})
            continue
        nb = _coerce_and_sanitize_cached_nav_bars(nb_raw)
        if not nb:
            detail = "Sin datos en caché. El refresco automático puede tardar unos minutos tras desplegar."
            if ck != str(isin).strip().upper():
                detail = (
                    f"Sin datos en caché para {isin}. El ISIN corregido es {ck}; "
                    "quita el ISIN erróneo y añade el correcto, o espera al refresco automático."
                )
            errors.append({"isin": isin, "detail": detail})
            continue
        items.append(
            {
                "isin": pl.get("isin") or ck,
                "symbol": pl.get("symbol") or "",
                "name": _resolve_benchmark_display_name(ck, pl if isinstance(pl, dict) else {}),
                "clasificacion": pl.get("clasificacion") or "renta_variable",
                "total_return_pct": None,
                "points": [],
                "nav_bars": nb,
                "source": pl.get("source") or "supabase_cache",
            }
        )
    crypto_items: List[Dict[str, Any]] = []
    crypto_errors: List[Dict[str, str]] = []
    for t in DEFAULT_CRYPTO_TICKERS:
        ck = crypto_instrument_key(t)
        pl = rows.get(str(ck).strip().upper())
        nb_raw = _nav_bars_from_cached_payload(pl)
        if not nb_raw:
            crypto_errors.append(
                {
                    "symbol": t,
                    "detail": "Sin datos en caché. El refresco automático puede tardar unos minutos tras desplegar.",
                }
            )
            continue
        nb = _coerce_and_sanitize_cached_nav_bars(nb_raw)
        if not nb:
            crypto_errors.append(
                {
                    "symbol": t,
                    "detail": "Sin datos en caché. El refresco automático puede tardar unos minutos tras desplegar.",
                }
            )
            continue
        crypto_items.append(
            {
                "isin": "",
                "symbol": pl.get("symbol") or t,
                "name": pl.get("name") or t,
                "clasificacion": "criptoactivos",
                "total_return_pct": None,
                "points": [],
                "nav_bars": nb,
                "source": pl.get("source") or "supabase_cache",
            }
        )
    return {
        "success": True,
        "period": STORE_HORIZON_PERIOD,
        "range": STORE_HORIZON_PERIOD,
        "horizon": STORE_HORIZON_PERIOD,
        "interval": _interval_for_period(STORE_HORIZON_PERIOD),
        "source": "supabase_cache",
        "items": items,
        "errors": errors,
        "crypto_items": crypto_items,
        "crypto_errors": crypto_errors,
    }


def _interval_for_period(period_key: str) -> str:
    if period_key == "ytd":
        return "1wk"
    if period_key == "1m":
        return "1d"
    if period_key in ("1y", "3y"):
        return "1mo"
    if period_key == "5y":
        return "1d"
    return "1wk"


async def build_benchmarks_payload(period: str, user_id: str, isins: List[str]) -> Dict[str, Any]:
    if period not in API_PERIODS:
        period = "ytd"
    if not isins:
        raise ValueError("Lista de ISIN vacía")
    if len(isins) > _MAX_USER_ISINS:
        raise ValueError(f"Máximo {_MAX_USER_ISINS} ISIN por usuario")
    # `period` lo ignora el payload: siempre horizonte almacenado; el front filtra la ventana.
    _ = period
    ck = _cache_key(user_id, "supabase_full", isins)
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

        payload = await asyncio.to_thread(_build_benchmarks_payload_from_supabase_sync, user_id, isins)
        items = payload.get("items") or []
        citems = payload.get("crypto_items") or []
        errs = payload.get("errors") or []
        cerrs = payload.get("crypto_errors") or []
        # No guardar en RAM un “todo vacío”: si Supabase se rellena justo después, el cliente vería fallo hasta expirar TTL.
        if len(items) == 0 and len(citems) == 0:
            return payload
        ttl = _BENCHMARK_GET_CACHE_TTL_SEC
        if len(isins) > 0 and len(items) == 0 and len(errs) >= len(isins):
            ttl = min(ttl, _BENCHMARK_GET_CACHE_TTL_SOFT_FAIL_SEC)
        elif errs or cerrs:
            ttl = min(ttl, _BENCHMARK_GET_CACHE_TTL_PARTIAL_ERR_SEC)
        _CACHE[ck] = (time.monotonic() + ttl, payload)
        return payload
