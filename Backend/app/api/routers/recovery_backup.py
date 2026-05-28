from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from app.api.errors import internal_server_error
from app.api.services.supabase.supabase_service import supabase_service

router = APIRouter(prefix="/GET/recovery", tags=["GET"])


@router.post(
    "/copy-transactions",
    summary="Copia completa de public.transactions a recovery.transactions",
    response_model=Dict[str, Any],
)
async def copy_transactions_to_recovery() -> Dict[str, Any]:
    if not supabase_service.is_connected():
        raise HTTPException(status_code=503, detail="Servicio de base de datos no disponible")
    try:
        result = supabase_service.copy_public_transactions_to_recovery()
        return {"success": True, "result": result}
    except Exception as e:
        raise internal_server_error(e, "copy_transactions_to_recovery")
