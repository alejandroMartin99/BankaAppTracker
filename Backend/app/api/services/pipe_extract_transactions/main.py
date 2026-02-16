import hashlib
import pandas as pd
import numpy as np
from io import BytesIO
from typing import Union
from pathlib import Path

from app.api.services.pipe_extract_transactions.decode_ibercaja import main_decode_ibercaja
from app.api.services.pipe_extract_transactions.decode_revolut import main_decode_revolut


def generate_transaction_id(row: pd.Series) -> str:
    """
    Genera un ID único y determinístico para una transacción.
    Usa campos clave para crear un hash único.
    """
    # Construir string único con los campos principales
    unique_string = (
        f"{row.get('DT_DATE', '')}"
        f"|{row.get('Importe', '')}"
        f"|{row.get('Descripción', '')}"
        f"|{row.get('Cuenta', '')}"
        f"|{row.get('Referencia', '')}"
        f"|{row.get('Saldo', '')}"
    )
    
    # Generar hash SHA-256
    hash_object = hashlib.sha256(unique_string.encode('utf-8'))
    
    # Retornar primeros 32 caracteres del hash
    return hash_object.hexdigest()[:32]


def main_file_parser(file_content: bytes, is_csv: bool = False) -> tuple[pd.DataFrame, str, str, str]:
    """
    Parsea el archivo y devuelve (DataFrame, tipo_origen, account_identifier, display_name).
    tipo_origen: 'Revolut' | 'Ibercaja'
    account_identifier: identificador estable (ibercaja_716552, revolut)
    display_name: nombre mostrado (Conjunta, Revolut, etc.)
    """
    if is_csv:
        df = pd.read_csv(BytesIO(file_content))
    else:
        df = pd.read_excel(BytesIO(file_content), engine="openpyxl", header=None)

    # Ibercaja -> Identificar en celda texto
    cell_value = str(df.iloc[2, 0]).strip().upper()

    # Revolut -> Identificar cabecera
    df_columns = df.columns.tolist()
    revolut_header = [
        'Tipo', 
        'Producto', 
        'Fecha de inicio', 
        'Fecha de finalización', 
        'Descripción', 
        'Importe',
        'Comisión',
        'Divisa',
        'State',
        'Saldo'
    ]

    if "CONSULTA MOVIMIENTOS DE LA CUENTA" in cell_value:
        print("Archivo identificado como IBERCAJA")
        df_transactions, account_identifier, display_name = main_decode_ibercaja(df)
        source_type = "Ibercaja"
    elif df_columns == revolut_header:
        print("Archivo identificado como Revolut")
        df_transactions, account_identifier, display_name = main_decode_revolut(df)
        source_type = "Revolut"
    else:
        raise ValueError("Formato de archivo no reconocido")
    
    # Generar transaction_id para cada fila
    df_transactions['transaction_id'] = df_transactions.apply(generate_transaction_id, axis=1)

    duplicated_mask = df_transactions["transaction_id"].duplicated(keep=False)

    if duplicated_mask.any():
        duplicated_rows = df_transactions.loc[duplicated_mask].sort_values(
            "transaction_id"
        )

        # Logging claro para debug
        print("⚠️ Se han detectado transaction_id duplicados en el fichero:")
        print(
            duplicated_rows[
                [
                    "transaction_id",
                    "DT_DATE",
                    "Importe",
                    "Descripción",
                    "Cuenta",
                    "Referencia",
                ]
            ]
        )

        # Opción A (recomendada): abortar
        raise ValueError(
            f"Se han detectado {duplicated_mask.sum()} transacciones duplicadas "
            "en el archivo. Revisa el criterio del hash."
        )

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
        "Referencia": "referencia"
    })

    return df_transactions, source_type, account_identifier, display_name