from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Dict, Any, Optional

from app.api.deps import get_current_user
from app.api.services.supabase.supabase_service import supabase_service

router = APIRouter(
    prefix="/GET",
    tags=["GET"]
)


def _fetch_all_for_balances(account_identifiers: list[str]) -> list:
    """Obtiene transacciones para calcular saldos (solo cuentas del usuario)."""
    if not account_identifiers:
        return []
    try:
        query = (
            supabase_service.supabase
            .table("transactions")
            .select("dt_date, saldo, cuenta, account_identifier")
            .in_("account_identifier", account_identifiers)
            .order("dt_date", desc=True)
            .limit(2000)
        )
        response = query.execute()
    except Exception:
        try:
            query = (
                supabase_service.supabase
                .table("transactions")
                .select("transaction_date, balance, account_number, account_identifier")
                .in_("account_identifier", account_identifiers)
                .order("transaction_date", desc=True)
                .limit(2000)
            )
            response = query.execute()
        except Exception:
            return []
    data = response.data or []
    for row in data:
        row["dt_date"] = row.get("dt_date") or row.get("transaction_date")
        row["saldo"] = row.get("saldo") if "saldo" in row else row.get("balance")
        row["cuenta"] = row.get("cuenta") or row.get("account_number") or "Otra"
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
        account_ids = supabase_service.get_user_account_identifiers(user.get("sub", ""))
        data = _fetch_all_for_balances(account_ids)
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

    account_ids = supabase_service.get_user_account_identifiers(user.get("sub", ""))
    if not account_ids:
        return {"success": True, "count": 0, "limit": limit, "offset": offset, "data": []}

    try:
        date_col = "dt_date"
        try:
            query = (
                supabase_service.supabase
                .table("transactions")
                .select("*")
                .in_("account_identifier", account_ids)
            )
            if from_date:
                query = query.gte(date_col, from_date)
            if to_date:
                query = query.lte(date_col, to_date)
            query = query.order(date_col, desc=True).range(offset, offset + limit - 1)
            response = query.execute()
        except Exception as col_err:
            if "dt_date" in str(col_err) or "column" in str(col_err).lower():
                date_col = "transaction_date"
                query = (
                    supabase_service.supabase
                    .table("transactions")
                    .select("*")
                    .in_("account_identifier", account_ids)
                )
                if from_date:
                    query = query.gte(date_col, from_date)
                if to_date:
                    query = query.lte(date_col, to_date)
                query = query.order(date_col, desc=True).range(offset, offset + limit - 1)
                response = query.execute()
            else:
                raise

        # Normalizar nombres de columnas al formato esperado por el frontend
        data = response.data or []
        for row in data:
            row["dt_date"] = row.get("dt_date") or row.get("transaction_date")
            row["importe"] = row.get("importe") if "importe" in row else row.get("amount", 0)
            row["descripcion"] = row.get("descripcion") or row.get("description", "")
            row["cuenta"] = row.get("cuenta") or row.get("account_number")
            row["categoria"] = row.get("categoria") or row.get("category")
            row["saldo"] = row.get("saldo") if "saldo" in row else row.get("balance")

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

