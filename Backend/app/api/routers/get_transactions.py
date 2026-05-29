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


class SharedConsentUpdate(BaseModel):
    enabled: bool

class MortgageSettingsUpdate(BaseModel):
    principal: float
    annual_rate: float
    term_years: int

class MortgageReceiptUpdate(BaseModel):
    transaction_id: int
    confirmed: bool
    included_in_calculation: bool


class BatchTransactionIds(BaseModel):
    ids: List[int]


class BatchCategoryUpdate(BaseModel):
    ids: List[int]
    categoria: Optional[str] = None
    subcategoria: Optional[str] = None


def _chunked(lst: list, size: int):
    for i in range(0, len(lst), size):
        yield lst[i : i + size]


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


def _is_shared_balances_enabled(user_id: str) -> bool:
    """Flag de consentimiento para incluir gastos de otros usuarios en Compartidos."""
    if not supabase_service.is_connected():
        return False
    try:
        r = (
            supabase_service.supabase
            .table("user_shared_settings")
            .select("shared_balances_enabled")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if r.data and len(r.data) > 0:
            return bool(r.data[0].get("shared_balances_enabled"))
    except Exception:
        pass
    # Por defecto: desactivado hasta consentimiento explícito
    return False


def _set_shared_balances_enabled(user_id: str, enabled: bool) -> None:
    if not supabase_service.is_connected():
        return
    supabase_service.supabase.table("user_shared_settings").upsert(
        {"user_id": user_id, "shared_balances_enabled": bool(enabled)},
        on_conflict="user_id",
    ).execute()


def _get_mortgage_settings(user_id: str) -> Dict[str, Any]:
    if not supabase_service.is_connected():
        return {"principal": 0, "annual_rate": 0, "term_years": 30}
    try:
        r = (
            supabase_service.supabase
            .table("user_mortgage_settings")
            .select("principal, annual_rate, term_years")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if r.data and len(r.data) > 0:
            row = r.data[0]
            return {
                "principal": float(row.get("principal") or 0),
                "annual_rate": float(row.get("annual_rate") or 0),
                "term_years": int(row.get("term_years") or 30),
            }
    except Exception:
        pass
    return {"principal": 0, "annual_rate": 0, "term_years": 30}


def _set_mortgage_settings(user_id: str, principal: float, annual_rate: float, term_years: int) -> None:
    if not supabase_service.is_connected():
        return
    supabase_service.supabase.table("user_mortgage_settings").upsert(
        {
            "user_id": user_id,
            "principal": float(principal or 0),
            "annual_rate": float(annual_rate or 0),
            "term_years": int(term_years or 30),
        },
        on_conflict="user_id",
    ).execute()


def _get_mortgage_receipts(user_id: str) -> List[Dict[str, Any]]:
    if not supabase_service.is_connected():
        return []
    try:
        r = (
            supabase_service.supabase
            .table("user_mortgage_receipts")
            .select("transaction_id, confirmed, included_in_calculation")
            .eq("user_id", user_id)
            .execute()
        )
        return list(r.data or [])
    except Exception:
        return []


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
        names = supabase_service.get_account_display_names(account_ids)
        seen = set()
        balances = {}
        for row in data:
            cuenta = names.get(row.get("account_id", ""), row.get("cuenta") or "Cuenta")
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
    page: int = Query(1, ge=1, description="Página (1-based)"),
    page_size: int = Query(500, ge=1, le=1000, description="Tamaño de página"),
    limit: Optional[int] = Query(None, ge=1, le=1000, description="Compatibilidad legacy"),
    offset: Optional[int] = Query(None, ge=0, description="Compatibilidad legacy"),
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")

    account_ids = supabase_service.get_user_account_ids(user.get("sub", ""))
    if not account_ids:
        return {"success": True, "count": 0, "data": []}

    effective_page_size = limit if limit is not None else page_size
    effective_offset = offset if offset is not None else (page - 1) * effective_page_size
    tx_select = "id,transaction_id,dt_date,importe,saldo,descripcion,categoria,subcategoria,account_id"

    try:
        q = (
            supabase_service.supabase
            .table("transactions")
            .select(tx_select, count="exact")
            .in_("account_id", account_ids)
        )
        if from_date:
            q = q.gte("dt_date", from_date)
        if to_date:
            # Incluir todo el día: hasta 23:59:59
            q = q.lte("dt_date", f"{to_date}T23:59:59.999999")
        response = (
            q.order("dt_date", desc=True)
            .range(effective_offset, effective_offset + effective_page_size - 1)
            .execute()
        )
        data = list(response.data or [])
        names = supabase_service.get_account_display_names(account_ids)
        for row in data:
            # Priorizar siempre el display_name actual de la cuenta
            row["cuenta"] = names.get(row.get("account_id", ""), row.get("cuenta") or "Cuenta")
        return {"success": True, "count": int(response.count or 0), "data": data, "page": page, "page_size": effective_page_size}
    except Exception as e:
        raise internal_server_error(e, "get_transactions")


@router.get(
    "/shared-transactions",
    summary="Transacciones para gastos compartidos (cuentas propias + vinculadas por cuentas compartidas)",
    response_model=Dict[str, Any]
)
async def get_shared_transactions(
    from_date: Optional[str] = Query(None, description="Fecha inicio YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, description="Fecha fin YYYY-MM-DD"),
    page: int = Query(1, ge=1, description="Página (1-based)"),
    page_size: int = Query(500, ge=1, le=1000, description="Tamaño de página"),
    limit: Optional[int] = Query(None, ge=1, le=1000, description="Compatibilidad legacy"),
    offset: Optional[int] = Query(None, ge=0, description="Compatibilidad legacy"),
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Transacciones para análisis compartido.

    Incluye:
    - cuentas del usuario actual
    - cuentas de usuarios que comparten al menos una cuenta con él.
    """
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")

    uid = user.get("sub", "")
    my_account_ids = supabase_service.get_owned_account_ids(uid)
    eligible_ids = set(supabase_service.get_share_eligible_account_ids())
    my_eligible_account_ids = [aid for aid in my_account_ids if aid in eligible_ids]
    linked_partner_ids = supabase_service.get_linked_partner_user_ids(uid)
    explicit_share_owner_ids = supabase_service.get_user_ids_sharing_accounts_with(uid)
    partner_user_ids = list(dict.fromkeys(linked_partner_ids + explicit_share_owner_ids))
    shared_with_user_name = (
        supabase_service.get_user_display_name(partner_user_ids[0])
        if partner_user_ids else None
    )
    shared_enabled = _is_shared_balances_enabled(uid)
    shared_account_ids = supabase_service.get_shared_account_ids(uid, permission="view") if shared_enabled else []
    partner_personal_ids = (
        supabase_service.get_partner_personal_account_ids(uid) if shared_enabled else []
    )
    visible_account_ids = list(
        dict.fromkeys(my_eligible_account_ids + shared_account_ids + partner_personal_ids)
    )
    my_account_set = set(my_eligible_account_ids)
    partner_account_set = set(shared_account_ids + partner_personal_ids) - my_account_set
    joint_account_ids = set(supabase_service.get_household_joint_account_ids(uid))

    partners_meta = []
    for pid in partner_user_ids:
        p_accounts = supabase_service.get_owned_account_ids(pid)
        p_eligible = [aid for aid in p_accounts if aid in eligible_ids and aid not in my_account_set]
        names = supabase_service.get_account_display_names(p_eligible) if p_eligible else {}
        partners_meta.append({
            "user_id": pid,
            "display_name": supabase_service.get_user_display_name(pid),
            "account_names": sorted(set(names.values())),
        })

    if not visible_account_ids:
        return {
            "success": True,
            "count": 0,
            "data": [],
            "shared_with_user_name": shared_with_user_name,
            "shared_balances_enabled": shared_enabled,
            "partners": partners_meta,
            "partner_accounts_linked": bool(partner_account_set),
            "joint_account_names": [],
        }

    effective_page_size = limit if limit is not None else page_size
    effective_offset = offset if offset is not None else (page - 1) * effective_page_size
    tx_select = "id,transaction_id,dt_date,importe,saldo,descripcion,categoria,subcategoria,account_id"
    account_owners = supabase_service.get_account_owner_user_ids(visible_account_ids)

    try:
        q = (
            supabase_service.supabase
            .table("transactions")
            .select(tx_select, count="exact")
            .in_("account_id", visible_account_ids)
        )
        if from_date:
            q = q.gte("dt_date", from_date)
        if to_date:
            q = q.lte("dt_date", f"{to_date}T23:59:59.999999")
        response = (
            q.order("dt_date", desc=True)
            .range(effective_offset, effective_offset + effective_page_size - 1)
            .execute()
        )
        data = list(response.data or [])
        names = supabase_service.get_account_display_names(visible_account_ids)
        joint_account_names = sorted(
            {names.get(aid, "") for aid in joint_account_ids if names.get(aid)}
        )
        for row in data:
            aid = row.get("account_id")
            row["cuenta"] = names.get(aid, row.get("cuenta") or "Cuenta")
            row["is_own_account"] = aid in my_account_set
            row["is_partner_account"] = aid in partner_account_set
            row["is_joint_account"] = aid in joint_account_ids
            row["account_owner_user_id"] = account_owners.get(aid)
        return {
            "success": True,
            "count": int(response.count or 0),
            "data": data,
            "page": page,
            "page_size": effective_page_size,
            "shared_with_user_name": shared_with_user_name,
            "shared_balances_enabled": shared_enabled,
            "partners": partners_meta,
            "partner_accounts_linked": bool(partner_account_set),
            "joint_account_names": joint_account_names,
        }
    except Exception as e:
        raise internal_server_error(e, "get_shared_transactions")


@router.patch(
    "/shared-consent",
    summary="Guardar consentimiento para incluir gastos de usuarios vinculados",
    response_model=Dict[str, Any],
)
async def update_shared_consent(
    payload: SharedConsentUpdate,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")
    try:
        uid = user.get("sub", "")
        _set_shared_balances_enabled(uid, payload.enabled)
        return {"success": True, "shared_balances_enabled": bool(payload.enabled)}
    except Exception as e:
        raise internal_server_error(e, "update_shared_consent")


@router.get(
    "/mortgage",
    summary="Obtener configuración de hipoteca y estados de recibos",
    response_model=Dict[str, Any],
)
async def get_mortgage_config(user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")
    try:
        uid = user.get("sub", "")
        return {
            "success": True,
            "settings": _get_mortgage_settings(uid),
            "receipts": _get_mortgage_receipts(uid),
        }
    except Exception as e:
        raise internal_server_error(e, "get_mortgage_config")


@router.patch(
    "/mortgage/settings",
    summary="Guardar configuración de hipoteca",
    response_model=Dict[str, Any],
)
async def update_mortgage_settings(
    payload: MortgageSettingsUpdate,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")
    try:
        uid = user.get("sub", "")
        _set_mortgage_settings(uid, payload.principal, payload.annual_rate, payload.term_years)
        return {"success": True, "settings": _get_mortgage_settings(uid)}
    except Exception as e:
        raise internal_server_error(e, "update_mortgage_settings")


@router.patch(
    "/mortgage/receipts",
    summary="Guardar estado de un recibo de hipoteca",
    response_model=Dict[str, Any],
)
async def update_mortgage_receipt(
    payload: MortgageReceiptUpdate,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")
    uid = user.get("sub", "")
    account_ids = supabase_service.get_user_account_ids(uid)
    if not account_ids:
        raise HTTPException(status_code=404, detail="No se han encontrado cuentas para el usuario")
    try:
        # Validar propiedad del movimiento
        r = (
            supabase_service.supabase
            .table("transactions")
            .select("id, account_id")
            .eq("id", payload.transaction_id)
            .limit(1)
            .execute()
        )
        rows = r.data or []
        if not rows:
            raise HTTPException(status_code=404, detail="Transacción no encontrada")
        if rows[0].get("account_id") not in account_ids:
            raise HTTPException(status_code=403, detail="No tienes permiso para este movimiento")

        supabase_service.supabase.table("user_mortgage_receipts").upsert(
            {
                "user_id": uid,
                "transaction_id": int(payload.transaction_id),
                "confirmed": bool(payload.confirmed),
                "included_in_calculation": bool(payload.included_in_calculation),
            },
            on_conflict="user_id,transaction_id",
        ).execute()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise internal_server_error(e, "update_mortgage_receipt")


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
        if not supabase_service.can_access_transaction(user_id, int(tx.get("id")), permission="edit"):
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
        if not supabase_service.can_access_transaction(user_id, int(tx.get("id")), permission="edit"):
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
    owned_ids = set(supabase_service.get_owned_account_ids(user_id))
    if not owned_ids:
        raise HTTPException(status_code=404, detail="No se han encontrado cuentas para el usuario")

    if account_id not in owned_ids:
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


@router.post(
    "/transactions/batch-delete",
    summary="Eliminar varias transacciones propias",
    response_model=Dict[str, Any],
)
async def delete_transactions_batch(
    body: BatchTransactionIds = Body(...),
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Elimina en bloque por id; solo filas cuyo account_id pertenece al usuario."""
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")

    user_id = user.get("sub", "")
    owned_ids = set(supabase_service.get_owned_account_ids(user_id))
    shared_delete_ids = set(supabase_service.get_shared_account_ids(user_id, permission="delete"))
    allowed_account_ids = owned_ids.union(shared_delete_ids)
    if not allowed_account_ids:
        raise HTTPException(status_code=404, detail="No se han encontrado cuentas para el usuario")

    raw_ids = [i for i in (body.ids or []) if isinstance(i, int) and i > 0]
    seen: set[int] = set()
    ids = []
    for i in raw_ids:
        if i not in seen:
            seen.add(i)
            ids.append(i)
    if not ids:
        return {"success": True, "deleted": 0, "deleted_ids": []}
    if len(ids) > 5000:
        raise HTTPException(status_code=400, detail="Máximo 5000 ids por petición")

    try:
        account_set = allowed_account_ids
        allowed_ids: list[int] = []
        q_chunk = 200
        for part in _chunked(ids, q_chunk):
            r = (
                supabase_service.supabase.table("transactions")
                .select("id, account_id")
                .in_("id", part)
                .execute()
            )
            for row in r.data or []:
                if row.get("account_id") in account_set:
                    allowed_ids.append(row["id"])
        if not allowed_ids:
            return {"success": True, "deleted": 0, "deleted_ids": []}

        del_chunk = 200
        for chunk in _chunked(allowed_ids, del_chunk):
            supabase_service.supabase.table("transactions").delete().in_("id", chunk).execute()

        return {"success": True, "deleted": len(allowed_ids), "deleted_ids": allowed_ids}
    except HTTPException:
        raise
    except Exception as e:
        raise internal_server_error(e, "delete_transactions_batch")


@router.post(
    "/transactions/batch-category",
    summary="Actualizar categoría/subcategoría en bloque",
    response_model=Dict[str, Any],
)
async def update_transactions_category_batch(
    body: BatchCategoryUpdate = Body(...),
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Aplica la misma categoría y subcategoría a varias filas propias."""
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")

    user_id = user.get("sub", "")
    owned_ids = set(supabase_service.get_owned_account_ids(user_id))
    shared_edit_ids = set(supabase_service.get_shared_account_ids(user_id, permission="edit"))
    allowed_account_ids = owned_ids.union(shared_edit_ids)
    if not allowed_account_ids:
        raise HTTPException(status_code=404, detail="No se han encontrado cuentas para el usuario")

    raw_ids = [i for i in (body.ids or []) if isinstance(i, int) and i > 0]
    seen: set[int] = set()
    ids = []
    for i in raw_ids:
        if i not in seen:
            seen.add(i)
            ids.append(i)
    if not ids:
        return {"success": True, "updated": 0, "updated_ids": []}
    if len(ids) > 5000:
        raise HTTPException(status_code=400, detail="Máximo 5000 ids por petición")

    update_data: Dict[str, Any] = {}
    if body.categoria is not None:
        update_data["categoria"] = body.categoria.strip() or None
    if body.subcategoria is not None:
        update_data["subcategoria"] = body.subcategoria.strip() or None
    if not update_data:
        return {"success": True, "updated": 0, "updated_ids": []}

    try:
        account_set = allowed_account_ids
        allowed_ids: list[int] = []
        q_chunk = 200
        for part in _chunked(ids, q_chunk):
            r = (
                supabase_service.supabase.table("transactions")
                .select("id, account_id")
                .in_("id", part)
                .execute()
            )
            for row in r.data or []:
                if row.get("account_id") in account_set:
                    allowed_ids.append(row["id"])
        if not allowed_ids:
            return {"success": True, "updated": 0, "updated_ids": []}

        up_chunk = 200
        for chunk in _chunked(allowed_ids, up_chunk):
            supabase_service.supabase.table("transactions").update(update_data).in_("id", chunk).execute()

        return {"success": True, "updated": len(allowed_ids), "updated_ids": allowed_ids}
    except HTTPException:
        raise
    except Exception as e:
        raise internal_server_error(e, "update_transactions_category_batch")


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
        if not supabase_service.can_access_transaction(user_id, int(tx.get("id")), permission="delete"):
            raise HTTPException(status_code=403, detail="No tienes permiso para eliminar esta transacción")

        supabase_service.supabase.table("transactions").delete().eq("id", row_id).execute()
        return {"success": True, "deleted": 1}
    except HTTPException:
        raise
    except Exception as e:
        raise internal_server_error(e, "delete_transaction")

