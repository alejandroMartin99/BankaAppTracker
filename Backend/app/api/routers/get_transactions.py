from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from typing import Dict, Any, Optional
from app.api.services.supabase.supabase_service import supabase_service

router = APIRouter(
    prefix="/GET",
    tags=["GET"]
)


def _fetch_all_for_balances() -> list:
    """Obtiene transacciones para calcular saldos por cuenta (última por cuenta)"""
    try:
        response = (
            supabase_service.supabase
            .table("transactions")
            .select("dt_date, saldo, cuenta")
            .order("dt_date", desc=True)
            .limit(2000)
            .execute()
        )
    except Exception:
        response = (
            supabase_service.supabase
            .table("transactions")
            .select("transaction_date, balance, account_number")
            .order("transaction_date", desc=True)
            .limit(2000)
            .execute()
        )
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
async def get_balances() -> Dict[str, Any]:
    """Devuelve el saldo más reciente de cada cuenta (última transacción por cuenta)."""
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")
    try:
        data = _fetch_all_for_balances()
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
) -> Dict[str, Any]:

    if not supabase_service.is_connected():
        raise HTTPException(
            status_code=503,
            detail="Servicio de base de datos no disponible"
        )

    try:
        # Soporta ambos esquemas: dt_date (pipe) y transaction_date (schema.sql)
        date_col = "dt_date"
        try:
            query = (
                supabase_service.supabase
                .table("transactions")
                .select("*")
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

