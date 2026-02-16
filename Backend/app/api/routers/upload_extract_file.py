from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from typing import Dict, Any
import pandas as pd

from app.api.deps import get_current_user
from app.api.services.pipe_extract_transactions.main import main_file_parser
from app.api.services.supabase.supabase_service import supabase_service

router = APIRouter(
    prefix="/upload",
    tags=["Upload"]
)

ALLOWED_EXTENSIONS = {".xlsx", ".xls",".csv"}


@router.post(
    "/Transactions",
    summary="Subir archivo Excel de transacciones y extraer datos",
    response_model=Dict[str, Any]
)
async def upload_transactions_file(
    file: UploadFile = File(...),
    _user: dict = Depends(get_current_user),
) -> Dict[str, Any]:

    # Validar extensión del archivo
    if not any(file.filename.lower().endswith(ext) for ext in ALLOWED_EXTENSIONS):
        raise HTTPException(
            status_code=400,
            detail="Formato no soportado. Solo Excel (.xlsx, .xls, .csv)"
        )

    # Leer contenido del archivo
    file_bytes = await file.read()
    print(f"Archivo leído: {file.filename}, tamaño: {len(file_bytes)} bytes")

    # Detectar tipo de archivo
    is_csv = file.filename.lower().endswith('.csv')
    
    # Ejecutar pipeline de parseo
    df_transactions, source_type, account_identifier, display_name = main_file_parser(
        file_bytes, is_csv=is_csv
    )

    # Validar resultado no vacío
    if df_transactions.empty:
        raise HTTPException(
            status_code=422,
            detail="El fichero no contiene transacciones válidas"
        )

    # Verificar conexión a base de datos
    if not supabase_service.is_connected():
        print("ERROR: Supabase no conectado")
        raise HTTPException(
            status_code=503,
            detail="Servicio de base de datos no disponible"
        )

    # Registrar la cuenta como del usuario (si subes un extracto, es tu cuenta)
    user_id = _user.get("sub")
    if user_id:
        supabase_service.upsert_user_account(
            user_id=user_id,
            account_identifier=account_identifier,
            source=source_type.lower(),
            display_name=display_name,
        )

    # Añadir account_identifier a cada transacción
    transactions_list = df_transactions.to_dict(orient="records")
    for t in transactions_list:
        t["account_identifier"] = account_identifier

    # Insertar transacciones en base de datos
    result = supabase_service.insert_transactions_with_duplicates_report(
        transactions_list
    )

    # Retornar resumen de la operación
    return {
        "success": True,
        "filename": file.filename,
        "source_type": source_type,
        "summary": {
            "total_received": result["received"],
            "total_inserted": result["inserted"],
            "total_duplicates": len(result["duplicates"])
        },
    }

