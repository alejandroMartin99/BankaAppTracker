import hashlib
import pandas as pd
import numpy as np
from io import BytesIO
from typing import Union
from pathlib import Path

from app.api.services.pipe_extract_transactions.decode_ibercaja import main_decode_ibercaja
from app.api.services.pipe_extract_transactions.decode_revolut import (
    prepare_revolut_dataframe,
    main_decode_revolut,
)
from app.api.services.pipe_extract_transactions.decode_pluxee import main_decode_pluxee, is_pluxee_file
from app.api.services.pipe_extract_transactions.decode_santander import main_decode_santander


def _norm_val(x, decimals: bool = False) -> str:
    """Normaliza valor para el hash: None/nan -> '', números con 2 decimales fijos."""
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return ""
    if decimals:
        try:
            if isinstance(x, str):
                x = float(x.replace(",", "."))
            return f"{float(x):.2f}"
        except (TypeError, ValueError):
            return str(x).strip() or ""
    s = str(x).strip()
    return s if s else ""


def generate_transaction_id(row: pd.Series) -> str:
    """
    Genera un ID único y determinístico para una transacción.
    Usa fecha (solo YYYY-MM-DD, sin hh:mm:ss ficticias), descripción, referencia, importe y saldo,
    para que la misma operación genere siempre el mismo ID y los duplicados se detecten bien.
    """
    # Fecha: solo día (primeros 10 caracteres) para no depender de segundos añadidos
    raw_dt = row.get("DT_DATE", "") or row.get("dt_date", "")
    date_part = _norm_val(raw_dt)
    if len(date_part) > 10:
        date_part = date_part[:10]
    elif " " in date_part:
        date_part = date_part.split(" ")[0]
    # Campos estables para unicidad
    desc = _norm_val(row.get("Descripción") or row.get("descripcion"))
    ref = _norm_val(row.get("Referencia") or row.get("referencia"))
    imp = _norm_val(row.get("Importe") or row.get("importe"), decimals=True)
    sal = _norm_val(row.get("Saldo") or row.get("saldo"), decimals=True)
    cuenta = _norm_val(row.get("Cuenta") or row.get("cuenta"))
    account_identifier = _norm_val(row.get("AccountIdentifier") or row.get("account_identifier"))

    unique_string = f"{date_part}|{desc}|{ref}|{imp}|{sal}|{cuenta}|{account_identifier}"
    hash_object = hashlib.sha256(unique_string.encode("utf-8"))
    return hash_object.hexdigest()[:32]


def main_file_parser(
    file_content: bytes,
    is_csv: bool = False,
    user_id: str | None = None,
) -> tuple[pd.DataFrame, str, str, str]:
    """
    Parsea el archivo y devuelve (DataFrame, tipo_origen, account_identifier, display_name).
    tipo_origen: 'Revolut' | 'Ibercaja'
    account_identifier: identificador estable (ibercaja_716552, revolut)
    display_name: nombre mostrado (Conjunta, Revolut, etc.)
    """
    if is_csv:
        df = None
        for encoding in ("utf-8-sig", "utf-8", "latin-1"):
            try:
                df = pd.read_csv(BytesIO(file_content), encoding=encoding)
                break
            except UnicodeDecodeError:
                continue
        if df is None:
            df = pd.read_csv(BytesIO(file_content))
    else:
        df = pd.read_excel(BytesIO(file_content), engine="openpyxl", header=None)

    df_revolut = prepare_revolut_dataframe(df)

    if df_revolut is not None:
        print("Archivo identificado como Revolut")
        df_transactions, account_identifier, display_name = main_decode_revolut(df_revolut)
        source_type = "Revolut"
    elif len(df) > 2 and "CONSULTA MOVIMIENTOS DE LA CUENTA" in str(df.iloc[2, 0]).strip().upper():
        print("Archivo identificado como IBERCAJA")
        df_transactions, account_identifier, display_name = main_decode_ibercaja(df)
        source_type = "Ibercaja"
    elif is_pluxee_file(df):
        print("Archivo identificado como Pluxee")
        df_transactions, account_identifier, display_name = main_decode_pluxee(df)
        source_type = "Pluxee"
    elif pd.notna(df.iloc[7, 0]) and "Fecha operación" in str(df.iloc[7, 0]).strip():
        print("Archivo identificado como SANTANDER")
        df_transactions, account_identifier, display_name = main_decode_santander(df)
        source_type = "Santander"
    else:
        print(f"Formato no reconocido. Columnas: {df.columns.tolist()[:15]}")
        raise ValueError("Formato de archivo no reconocido")
    
    # Aislar cuentas sin identificador fuerte por usuario (evita colisiones entre usuarios).
    uid = (user_id or "").strip()
    uid_part = uid.replace("-", "")[:12]
    if uid and source_type in ("Revolut", "Pluxee"):
        account_identifier = f"{account_identifier}__{uid_part}"

    # Generar transaction_id para cada fila (incluye account_identifier).
    df_transactions["AccountIdentifier"] = account_identifier
    df_transactions['transaction_id'] = df_transactions.apply(generate_transaction_id, axis=1)

    duplicated_mask = df_transactions["transaction_id"].duplicated(keep=False)

    if duplicated_mask.any():
        n_dup = int(duplicated_mask.sum())
        err_msg = (
            f"Se han detectado {n_dup} transacciones duplicadas en el archivo. "
            "Revisa el criterio del hash."
        )
        duplicated_rows = df_transactions.loc[duplicated_mask].sort_values(
            "transaction_id"
        )
        cols_show = [
            "transaction_id",
            "DT_DATE",
            "Importe",
            "Descripción",
            "Cuenta",
            "Referencia",
        ]
        dup_view = duplicated_rows[cols_show]

        print("=" * 72)
        print("ERROR IMPORTACIÓN — transacciones duplicadas (mismo transaction_id)")
        print(err_msg)
        print("-" * 72)
        print(dup_view.to_string(index=True))
        print("-" * 72)
        print("(Filas anteriores: mismo hash = mismo date_part|desc|ref|importe|saldo|cuenta)")
        print("=" * 72)

        raise ValueError(err_msg)

    # Rename for consistency
    df_transactions = df_transactions.rename(columns={
        "DT_DATE": "dt_date",
        "Importe": "importe",
        "Saldo": "saldo",
        "Cuenta": "cuenta",
        "Descripción": "descripcion",
        "Categoria": "categoria",
        "Subcategoria": "subcategoria",
        "BizumMensaje": "bizum_mensaje",
        "Referencia": "referencia",
        "AccountIdentifier": "account_identifier",
    })

    if "account_identifier" in df_transactions.columns:
        df_transactions = df_transactions.drop(columns=["account_identifier"])

    return df_transactions, source_type, account_identifier, display_name