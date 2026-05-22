from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.api.errors import internal_server_error
from app.api.services.recurring_payments import (
    build_recurring_payment_history_payload,
    build_recurring_payments_payload,
)
from app.api.services.supabase.supabase_service import supabase_service

router = APIRouter(prefix="/GET", tags=["GET"])


class RecurringPaymentDismissBody(BaseModel):
    pattern_key: str = Field(..., min_length=1, max_length=120)
    label: Optional[str] = Field(None, max_length=200)


@router.get(
    "/recurring-payments",
    summary="Pagos mensuales recurrentes detectados (estado automático por mes)",
    response_model=Dict[str, Any],
)
async def get_recurring_payments(
    month: Optional[str] = None,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")
    uid = user.get("sub", "")
    try:
        return build_recurring_payments_payload(uid, month)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise internal_server_error(e, "get_recurring_payments")


@router.get(
    "/recurring-payments/history",
    summary="Histórico mensual de un patrón recurrente",
    response_model=Dict[str, Any],
)
async def get_recurring_payment_history(
    pattern_key: str,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")
    uid = user.get("sub", "")
    key = (pattern_key or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="pattern_key vacío")
    try:
        return build_recurring_payment_history_payload(uid, key)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise internal_server_error(e, "get_recurring_payment_history")


@router.patch(
    "/recurring-payments/dismiss",
    summary="Ocultar un patrón recurrente (falso positivo)",
    response_model=Dict[str, Any],
)
async def dismiss_recurring_payment(
    body: RecurringPaymentDismissBody,
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")
    uid = user.get("sub", "")
    key = body.pattern_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="pattern_key vacío")
    try:
        supabase_service.dismiss_recurring_pattern(uid, key, body.label or key)
        return {"success": True, "pattern_key": key}
    except Exception as e:
        raise internal_server_error(e, "dismiss_recurring_payment")
