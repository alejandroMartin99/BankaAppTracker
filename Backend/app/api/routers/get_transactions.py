from fastapi import APIRouter, Depends, HTTPException, Query, Body
from typing import Dict, Any, Optional
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.api.services.supabase.supabase_service import supabase_service

router = APIRouter(
    prefix="/GET",
    tags=["GET"]
)


class CategoryUpdate(BaseModel):
    categoria: Optional[str] = None
    subcategoria: Optional[str] = None


class TransactionDetailsUpdate(BaseModel):
    """Campos editables de una transacción (todos opcionales)."""
    dt_date: Optional[str] = None  # ISO date or datetime, e.g. YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS
    descripcion: Optional[str] = None
    importe: Optional[float] = None


def _fetch_for_balances(account_ids: list[str]) -> list:
    """Saldos = valor 'saldo' de la última transacción de cada cuenta.
    dt_date incluye hh:mm:ss (Ibercaja: ficticias, Revolut: reales) para orden correcto."""
    if not account_ids:
        return []
    try:
        r = (
            supabase_service.supabase
            .table("transactions")
            .select("dt_date, saldo, cuenta, account_id")
            .in_("account_id", account_ids)
            .order("dt_date", desc=True)
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
    summary="Obtener transacciones (opcionalmente filtradas por fechas)",
    response_model=Dict[str, Any]
)
async def get_transactions(
    from_date: Optional[str] = Query(None, description="Fecha inicio YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, description="Fecha fin YYYY-MM-DD"),
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")

    account_ids = supabase_service.get_user_account_ids(user.get("sub", ""))
    if not account_ids:
        return {"success": True, "count": 0, "data": []}

    try:
        q = (
            supabase_service.supabase
            .table("transactions")
            .select("*")
            .in_("account_id", account_ids)
        )
        if from_date:
            q = q.gte("dt_date", from_date)
        if to_date:
            # Incluir todo el día: hasta 23:59:59
            q = q.lte("dt_date", f"{to_date}T23:59:59.999999")
        response = q.order("dt_date", desc=True).limit(10000).execute()
        data = list(response.data or [])
        names = supabase_service.get_account_display_names(account_ids)
        for row in data:
            row["cuenta"] = row.get("cuenta") or names.get(row.get("account_id", ""), "Cuenta")
        return {"success": True, "count": len(data), "data": data}
    except Exception as e:
        import traceback
        print(f"[ERROR] get_transactions: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/shared-transactions",
    summary="Transacciones para análisis de gastos compartidos (propias + de usuarios que comparten cuenta)",
    response_model=Dict[str, Any]
)
async def get_shared_transactions(
    from_date: Optional[str] = Query(None, description="Fecha inicio YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, description="Fecha fin YYYY-MM-DD"),
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Devuelve gastos del usuario y de las personas que comparten alguna cuenta con él (ej. Conjunta).
    Cada fila incluye is_own_account: true si la cuenta es del usuario actual, false si es de otro."""
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")

    uid = user.get("sub", "")
    my_account_ids = supabase_service.get_user_account_ids(uid)
    # Usuarios que comparten al menos una cuenta (ej. Conjunta)
    other_user_ids = supabase_service.get_user_ids_sharing_accounts_with(uid)
    their_account_ids = supabase_service.get_account_ids_for_users(other_user_ids) if other_user_ids else []
    all_account_ids = list(dict.fromkeys(my_account_ids + their_account_ids))
    my_account_set = set(my_account_ids)

    if not all_account_ids:
        return {"success": True, "count": 0, "data": []}

    try:
        q = (
            supabase_service.supabase
            .table("transactions")
            .select("*")
            .in_("account_id", all_account_ids)
        )
        if from_date:
            q = q.gte("dt_date", from_date)
        if to_date:
            q = q.lte("dt_date", f"{to_date}T23:59:59.999999")
        response = q.order("dt_date", desc=True).limit(10000).execute()
        data = list(response.data or [])
        names = supabase_service.get_account_display_names(all_account_ids)
        for row in data:
            row["cuenta"] = row.get("cuenta") or names.get(row.get("account_id", ""), "Cuenta")
            row["is_own_account"] = row.get("account_id") in my_account_set
        return {"success": True, "count": len(data), "data": data}
    except Exception as e:
        import traceback
        print(f"[ERROR] get_shared_transactions: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.patch(
    "/transactions/{row_id}/category",
    summary="Actualizar categoría y subcategoría de una transacción existente",
    response_model=Dict[str, Any]
)
async def update_transaction_category(
    row_id: int,
    payload: CategoryUpdate = Body(...),
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Permite al usuario actualizar categoria y subcategoria de una transacción propia."""
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")

    user_id = user.get("sub", "")
    account_ids = supabase_service.get_user_account_ids(user_id)
    if not account_ids:
        raise HTTPException(status_code=404, detail="No se han encontrado cuentas para el usuario")

    try:
        # Comprobar que la transacción existe y pertenece a alguna de las cuentas del usuario
        r = (
            supabase_service.supabase
            .table("transactions")
            .select("id, account_id")
            .eq("id", row_id)
            .limit(1)
            .execute()
        )
        rows = r.data or []
        if not rows:
            raise HTTPException(status_code=404, detail="Transacción no encontrada")

        tx = rows[0]
        if tx.get("account_id") not in account_ids:
            raise HTTPException(status_code=403, detail="No tienes permiso para modificar esta transacción")

        update_data: Dict[str, Any] = {}
        if payload.categoria is not None:
            update_data["categoria"] = payload.categoria.strip() or None
        if payload.subcategoria is not None:
            update_data["subcategoria"] = payload.subcategoria.strip() or None

        if not update_data:
            return {"success": True, "updated": 0}

        supabase_service.supabase.table("transactions").update(update_data).eq("id", row_id).execute()
        return {"success": True, "updated": 1}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[ERROR] update_transaction_category: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.patch(
    "/transactions/{row_id}",
    summary="Actualizar detalles de una transacción (fecha, descripción, importe)",
    response_model=Dict[str, Any]
)
async def update_transaction_details(
    row_id: int,
    payload: TransactionDetailsUpdate = Body(...),
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Permite actualizar dt_date, descripcion e importe de una transacción propia."""
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")

    user_id = user.get("sub", "")
    account_ids = supabase_service.get_user_account_ids(user_id)
    if not account_ids:
        raise HTTPException(status_code=404, detail="No se han encontrado cuentas para el usuario")

    try:
        r = (
            supabase_service.supabase
            .table("transactions")
            .select("id, account_id")
            .eq("id", row_id)
            .limit(1)
            .execute()
        )
        rows = r.data or []
        if not rows:
            raise HTTPException(status_code=404, detail="Transacción no encontrada")

        tx = rows[0]
        if tx.get("account_id") not in account_ids:
            raise HTTPException(status_code=403, detail="No tienes permiso para modificar esta transacción")

        update_data: Dict[str, Any] = {}
        if payload.dt_date is not None:
            val = payload.dt_date.strip() if isinstance(payload.dt_date, str) else str(payload.dt_date)
            if val:
                if "T" not in val and len(val) <= 10:
                    val = f"{val}T00:00:00"
                update_data["dt_date"] = val
        if payload.descripcion is not None:
            update_data["descripcion"] = payload.descripcion.strip() if payload.descripcion else None
        if payload.importe is not None:
            update_data["importe"] = float(payload.importe)

        if not update_data:
            return {"success": True, "updated": 0}

        supabase_service.supabase.table("transactions").update(update_data).eq("id", row_id).execute()
        return {"success": True, "updated": 1}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[ERROR] update_transaction_details: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete(
    "/transactions/{row_id}",
    summary="Eliminar una transacción",
    response_model=Dict[str, Any]
)
async def delete_transaction(
    row_id: int,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Elimina una transacción propia (por id de fila)."""
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")

    user_id = user.get("sub", "")
    account_ids = supabase_service.get_user_account_ids(user_id)
    if not account_ids:
        raise HTTPException(status_code=404, detail="No se han encontrado cuentas para el usuario")

    try:
        r = (
            supabase_service.supabase
            .table("transactions")
            .select("id, account_id")
            .eq("id", row_id)
            .limit(1)
            .execute()
        )
        rows = r.data or []
        if not rows:
            raise HTTPException(status_code=404, detail="Transacción no encontrada")

        tx = rows[0]
        if tx.get("account_id") not in account_ids:
            raise HTTPException(status_code=403, detail="No tienes permiso para eliminar esta transacción")

        supabase_service.supabase.table("transactions").delete().eq("id", row_id).execute()
        return {"success": True, "deleted": 1}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[ERROR] delete_transaction: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

