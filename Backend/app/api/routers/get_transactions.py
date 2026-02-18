from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Dict, Any, Optional

from app.api.deps import get_current_user
from app.api.services.supabase.supabase_service import supabase_service

router = APIRouter(
    prefix="/GET",
    tags=["GET"]
)


def _fetch_for_balances(account_ids: list[str]) -> list:
    """Saldos = valor 'saldo' de la última transacción de cada cuenta (fecha más reciente, mayor saldo = cierre del día)."""
    if not account_ids:
        return []
    try:
        r = (
            supabase_service.supabase
            .table("transactions")
            .select("dt_date, saldo, cuenta, account_id")
            .in_("account_id", account_ids)
            .order("dt_date", desc=True)
            .order("saldo", desc=True, nullsfirst=False)  # mismo día: mayor saldo = última transacción (cierre)
            .limit(2000)
            .execute()
        )
    except Exception:
        return []
    data = r.data or []
    names = supabase_service.get_account_display_names(account_ids)
    for row in data:
        row["cuenta"] = row.get("cuenta") or names.get(row.get("account_id", ""), "Cuenta")
    return data


@router.get(
    "/balances",
    summary="Obtener saldo actual por cuenta",
    response_model=Dict[str, Any]
)
async def get_balances(user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    """Devuelve el saldo más reciente de cada cuenta del usuario."""
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")
    try:
        account_ids = supabase_service.get_user_account_ids(user.get("sub", ""))
        data = _fetch_for_balances(account_ids)
        seen = set()
        balances = {}
        for row in data:
            cuenta = row.get("cuenta") or "Otra"
            if cuenta and cuenta not in seen:
                seen.add(cuenta)
                saldo = row.get("saldo")
                balances[cuenta] = float(saldo) if saldo is not None else 0.0
        return {"success": True, "data": balances}
    except Exception as e:
        import traceback
        print(f"[ERROR] get_balances: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.get(
    "/transactions",
    summary="Obtener transacciones almacenadas",
    response_model=Dict[str, Any]
)
async def get_transactions(
    from_date: Optional[str] = Query(None, description="Fecha inicio (YYYY-MM-DD)"),
    to_date: Optional[str] = Query(None, description="Fecha fin (YYYY-MM-DD)"),
    limit: int = Query(500, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:

    if not supabase_service.is_connected():
        raise HTTPException(
            status_code=503,
            detail="Servicio de base de datos no disponible"
        )

    account_ids = supabase_service.get_user_account_ids(user.get("sub", ""))
    if not account_ids:
        return {"success": True, "count": 0, "limit": limit, "offset": offset, "data": []}

    try:
        query = (
            supabase_service.supabase
            .table("transactions")
            .select("*")
            .in_("account_id", account_ids)
        )
        if from_date:
            query = query.gte("dt_date", from_date)
        if to_date:
            query = query.lte("dt_date", to_date)
        query = query.order("dt_date", desc=True).range(offset, offset + limit - 1)
        response = query.execute()

        data = response.data or []
        names = supabase_service.get_account_display_names(account_ids)
        for row in data:
            row["cuenta"] = row.get("cuenta") or names.get(row.get("account_id", ""), "Cuenta")

        return {
            "success": True,
            "count": len(data),
            "limit": limit,
            "offset": offset,
            "data": data,
        }

    except Exception as e:
        import traceback
        print(f"[ERROR] get_transactions: {e}")
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Error al obtener transacciones: {str(e)}"
        )

