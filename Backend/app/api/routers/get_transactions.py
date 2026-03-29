from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from typing import Dict, Any, Optional, List
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.api.errors import internal_server_error
from app.api.services.supabase.supabase_service import supabase_service
from app.api.services.account_config import is_account_shared
from app.api.services.pipe_extract_transactions.category_rules import get_category_catalog_from_rules

router = APIRouter(
    prefix="/GET",
    tags=["GET"]
)


class CategoryUpdate(BaseModel):
    categoria: Optional[str] = None
    subcategoria: Optional[str] = None


class AccountUpdate(BaseModel):
    display_name: Optional[str] = None


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


def _merge_category_catalogs(a: Dict[str, Any], b: Dict[str, Any]) -> Dict[str, Any]:
    """Une dos catálogos {categories, subcategories_by_category} sin duplicar por nombre."""
    merged: Dict[str, set] = defaultdict(set)
    for part in (a, b):
        for c in part.get("categories") or []:
            c = (c or "").strip()
            if c:
                merged.setdefault(c, set())
        for cat, subs in (part.get("subcategories_by_category") or {}).items():
            cat = (cat or "").strip()
            if not cat:
                continue
            merged.setdefault(cat, set())
            for s in subs or []:
                s = (s or "").strip()
                if s:
                    merged[cat].add(s)
    categories = sorted(merged.keys(), key=lambda x: (x.lower(), x))
    return {
        "categories": categories,
        "subcategories_by_category": {c: sorted(merged[c]) for c in categories},
    }


@router.get(
    "/category-catalog",
    summary="Catálogo de categorías/subcategorías (BD + reglas del importador)",
    response_model=Dict[str, Any],
)
async def get_category_catalog(user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    """Unión de valores distintos en tus transacciones (Supabase) y de CATEGORY_RULES."""
    try:
        rules = get_category_catalog_from_rules()
        if not supabase_service.is_connected():
            return {"success": True, **rules}
        db_cat = supabase_service.get_category_catalog_from_user_transactions(user.get("sub", ""))
        data = _merge_category_catalogs(db_cat, rules)
        return {"success": True, **data}
    except Exception as e:
        raise internal_server_error(e, "get_category_catalog")


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
        raise internal_server_error(e, "get_balances")

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
            # Priorizar siempre el display_name actual de la cuenta
            row["cuenta"] = names.get(row.get("account_id", ""), row.get("cuenta") or "Cuenta")
        return {"success": True, "count": len(data), "data": data}
    except Exception as e:
        raise internal_server_error(e, "get_transactions")


@router.get(
    "/shared-transactions",
    summary="Transacciones para gastos compartidos (solo cuentas vinculadas a tu usuario)",
    response_model=Dict[str, Any]
)
async def get_shared_transactions(
    from_date: Optional[str] = Query(None, description="Fecha inicio YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, description="Fecha fin YYYY-MM-DD"),
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Misma visibilidad que /transactions: solo cuentas que tienes en user_accounts.

    No expone cuentas personales de otras personas aunque compartáis una cuenta conjunta.
    La cuenta conjunta tiene el mismo account_id para quienes la enlazan: todos ven esas
    transacciones si la tienen vinculada.

    is_own_account se mantiene por compatibilidad con el cliente (True si account_id está
    entre tus cuentas vinculadas; con este alcance, siempre True).
    """
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")

    uid = user.get("sub", "")
    my_account_ids = supabase_service.get_user_account_ids(uid)
    my_account_set = set(my_account_ids)

    if not my_account_ids:
        return {"success": True, "count": 0, "data": []}

    try:
        q = (
            supabase_service.supabase
            .table("transactions")
            .select("*")
            .in_("account_id", my_account_ids)
        )
        if from_date:
            q = q.gte("dt_date", from_date)
        if to_date:
            q = q.lte("dt_date", f"{to_date}T23:59:59.999999")
        response = q.order("dt_date", desc=True).limit(10000).execute()
        data = list(response.data or [])
        names = supabase_service.get_account_display_names(my_account_ids)
        for row in data:
            row["cuenta"] = names.get(row.get("account_id", ""), row.get("cuenta") or "Cuenta")
            row["is_own_account"] = row.get("account_id") in my_account_set
        return {"success": True, "count": len(data), "data": data}
    except Exception as e:
        raise internal_server_error(e, "get_shared_transactions")


@router.get(
    "/accounts",
    summary="Obtener cuentas del usuario actual",
    response_model=Dict[str, Any],
)
async def get_accounts(user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    """
    Devuelve las cuentas vinculadas al usuario actual.
    Cada item incluye id, display_name, stable_key y source.
    """
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")

    user_id = user.get("sub", "")
    account_ids: List[str] = supabase_service.get_user_account_ids(user_id)
    if not account_ids:
        return {"success": True, "data": []}

    try:
        r = (
            supabase_service.supabase
            .table("accounts")
            .select("id, display_name, stable_key, source")
            .in_("id", account_ids)
            .order("display_name", desc=False)
            .execute()
        )
        data = list(r.data or [])
        # Anotar si la cuenta es compartida según la config
        for row in data:
            row["shared"] = is_account_shared(
                str(row.get("source") or ""),
                str(row.get("stable_key") or ""),
            )
        return {"success": True, "data": data}
    except Exception as e:
        raise internal_server_error(e, "get_accounts")


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
        raise internal_server_error(e, "update_transaction_category")


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
        raise internal_server_error(e, "update_transaction_details")


@router.patch(
    "/accounts/{account_id}",
    summary="Actualizar nombre visible de una cuenta",
    response_model=Dict[str, Any],
)
async def update_account_display_name(
    account_id: str,
    payload: AccountUpdate = Body(...),
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Permite cambiar el display_name de una cuenta propia.
    """
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")

    user_id = user.get("sub", "")
    account_ids = supabase_service.get_user_account_ids(user_id)
    if not account_ids:
        raise HTTPException(status_code=404, detail="No se han encontrado cuentas para el usuario")

    if account_id not in account_ids:
        raise HTTPException(status_code=403, detail="No tienes permiso para modificar esta cuenta")

    try:
        new_name_raw = payload.display_name if payload.display_name is not None else ""
        new_name = new_name_raw.strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="El nombre de cuenta no puede estar vacío")

        supabase_service.supabase.table("accounts").update(
            {"display_name": new_name}
        ).eq("id", account_id).execute()

        return {"success": True, "updated": 1, "display_name": new_name}
    except HTTPException:
        raise
    except Exception as e:
        raise internal_server_error(e, "update_account_display_name")


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
        raise internal_server_error(e, "delete_transaction")

