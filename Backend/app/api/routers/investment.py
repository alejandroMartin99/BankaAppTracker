import asyncio
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from pydantic import BaseModel, Field, field_validator

from app.api.deps import get_current_user
from app.api.services.investment_benchmarks import (
    DEFAULT_AUTHOR_ISINS,
    build_benchmarks_payload,
    canonical_isin,
    max_user_isins,
    normalize_isin,
    refresh_instrument_keys_sync,
)
from app.api.services.investment_fund_detail import get_or_build_fund_detail, warm_fund_detail_cache_force_sync
from app.api.services.supabase.supabase_service import supabase_service

router = APIRouter(prefix="/GET", tags=["GET"])


class InvestmentFundBody(BaseModel):
    isin: str = Field(..., min_length=12, max_length=12)

    @field_validator("isin")
    @classmethod
    def strip_upper(cls, v: str) -> str:
        return v.strip().upper()


def _isins_from_db_rows(rows: List[Dict[str, Any]]) -> List[str]:
    out: List[str] = []
    for r in rows:
        raw = r.get("isin")
        if not raw or not isinstance(raw, str):
            continue
        try:
            out.append(canonical_isin(raw))
        except ValueError:
            continue
    return out


def _merge_default_and_user_isins(user_isins: List[str]) -> List[str]:
    """Orden: ISIN por defecto del autor, luego ISIN del usuario que no estén ya."""
    seen: set[str] = set()
    out: List[str] = []
    for isin in DEFAULT_AUTHOR_ISINS:
        if isin not in seen:
            seen.add(isin)
            out.append(isin)
    for isin in user_isins:
        if isin not in seen:
            seen.add(isin)
            out.append(isin)
    return out


def _resolve_isins_for_user(user_id: str) -> tuple[List[str], bool]:
    """
    Si no hay fondos guardados, solo la lista por defecto del autor.
    Si hay filas en la tabla del usuario, se unen (sin duplicar) con la lista por defecto.
    Devuelve (isins, using_default_watchlist).
    """
    if not supabase_service.is_connected():
        return list(DEFAULT_AUTHOR_ISINS), True
    rows = supabase_service.list_user_investment_funds(user_id)
    if not rows:
        return list(DEFAULT_AUTHOR_ISINS), True
    user_isins = _isins_from_db_rows(rows)
    if not user_isins:
        return list(DEFAULT_AUTHOR_ISINS), True
    return _merge_default_and_user_isins(user_isins), False


@router.get(
    "/investment/benchmarks",
    summary="Rentabilidad acumulada (%) de los ISIN del usuario (yfinance)",
    response_model=Dict[str, Any],
)
async def get_investment_benchmarks(
    period: str = Query(
        "ytd",
        description="Ignorado en servidor: siempre se devuelve el horizonte 5y en caché; el cliente filtra la ventana.",
    ),
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    if period not in ("ytd", "1m", "6m", "1y", "3y", "5y"):
        period = "ytd"
    uid = user.get("sub", "")
    isins, using_default = _resolve_isins_for_user(uid)
    if not supabase_service.is_connected():
        raise HTTPException(
            status_code=503,
            detail="Servicio de datos de inversión no disponible (Supabase).",
        )
    try:
        payload = await build_benchmarks_payload(period, uid, isins)
        payload["using_default_watchlist"] = using_default
        return payload
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"No se pudieron obtener datos: {e!s}") from e


@router.get(
    "/investment/funds",
    summary="Lista de ISIN guardados por el usuario para Inversión",
    response_model=Dict[str, Any],
)
async def list_investment_funds(user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")
    rows = supabase_service.list_user_investment_funds(user.get("sub", ""))
    return {
        "success": True,
        "items": rows,
        "default_isins": list(DEFAULT_AUTHOR_ISINS),
        "max_funds": max_user_isins(),
    }


@router.post(
    "/investment/funds",
    summary="Añadir un ISIN a la lista del usuario",
    response_model=Dict[str, Any],
)
async def add_investment_fund(
    body: InvestmentFundBody,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")
    uid = user.get("sub", "")
    try:
        isin = canonical_isin(body.isin)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if isin in DEFAULT_AUTHOR_ISINS:
        raise HTTPException(
            status_code=400,
            detail="Este ISIN ya forma parte de la selección por defecto de la app; no hace falta guardarlo en tu lista.",
        )
    n = supabase_service.count_user_investment_funds(uid)
    if n >= max_user_isins():
        raise HTTPException(
            status_code=400,
            detail=f"Máximo {max_user_isins()} fondos. Elimina alguno antes de añadir.",
        )
    try:
        supabase_service.add_user_investment_fund(uid, isin)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"No se pudo guardar: {e!s}") from e
    # Ficha Yahoo primero → nombres/composición en caché; luego serie benchmark (sigue el refresco periódico global).
    await asyncio.to_thread(warm_fund_detail_cache_force_sync, isin)
    await asyncio.to_thread(refresh_instrument_keys_sync, [isin])
    return {"success": True, "isin": isin}


@router.delete(
    "/investment/funds/{isin}",
    summary="Quitar un ISIN de la lista del usuario",
    response_model=Dict[str, Any],
)
async def remove_investment_fund(
    isin: str = Path(..., min_length=12, max_length=12),
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")
    uid = user.get("sub", "")
    try:
        isin_n = normalize_isin(isin)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    ok = supabase_service.remove_user_investment_fund(uid, isin_n)
    if not ok:
        raise HTTPException(status_code=404, detail="ISIN no estaba en tu lista")
    return {"success": True, "isin": isin_n}


@router.get(
    "/investment/fund-detail",
    summary="Ficha ampliada del fondo (yfinance + caché Supabase)",
    response_model=Dict[str, Any],
)
async def get_investment_fund_detail(
    response: Response,
    isin: Optional[str] = Query(None, min_length=12, max_length=12),
    symbol: Optional[str] = Query(None, description="Par Yahoo p. ej. BTC-USD (cripto)"),
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    _ = user
    response.headers["Cache-Control"] = "no-store, private"
    if (isin is None or isin.strip() == "") == (symbol is None or symbol.strip() == ""):
        raise HTTPException(
            status_code=400,
            detail="Indica exactamente uno: query `isin` (12 caracteres) o `symbol` (cripto).",
        )
    try:
        payload, _cached, _ck = await get_or_build_fund_detail(
            isin.strip().upper() if isin and isin.strip() else None,
            symbol.strip() if symbol and symbol.strip() else None,
        )
        return payload
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"No se pudo obtener la ficha: {e!s}") from e
