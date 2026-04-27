import re
import pandas as pd
import numpy as np
import warnings
from app.api.services.pipe_extract_transactions.category_rules import (
    CATEGORY_RULES,
    apply_unique_cuotes,
    analyze_description,
)

warnings.filterwarnings("ignore", message="Workbook contains no default style*")


def main_decode_santander(df: pd.DataFrame, account_map: dict | None = None) -> tuple[pd.DataFrame, str, str]:
    """Decodifica extractos de Santander y normaliza la tabla de transacciones.
    account_map: opcional, mapeo {iban_completo: nombre}. Si no se pasa, se usa Titular.
    Retorna: (DataFrame, account_identifier, display_name)
    """

    # 1. Buscar dinámicamente las etiquetas "Cuenta" y "Titular" en el DataFrame
    iban_raw = None
    display_name = "Santander"

    # Buscar en todas las celdas las etiquetas
    for idx, row in df.iterrows():
        for col_idx, cell in enumerate(row):
            cell_str = str(cell).strip() if pd.notna(cell) else ""

            # Buscar "Cuenta" y extraer IBAN de la siguiente fila
            if cell_str.upper() == "CUENTA":
                if idx + 1 < len(df):
                    iban_raw = str(df.iloc[idx + 1, col_idx]).strip()

            # Buscar "Titular" y extraer nombre de la siguiente fila
            if cell_str.upper() == "TITULAR":
                if idx + 1 < len(df):
                    display_name = str(df.iloc[idx + 1, col_idx]).strip()

    if not iban_raw:
        raise ValueError("No se pudo detectar el IBAN (no se encontró 'Cuenta')")

    # Remover espacios y extraer últimos 7 dígitos
    iban_clean = iban_raw.replace(" ", "")
    iban_suffix = iban_clean[-7:] if len(iban_clean) >= 7 else iban_clean

    if not iban_suffix.isdigit():
        raise ValueError(f"IBAN sufijo inválido: {iban_suffix}")

    account_identifier = f"santander_{iban_suffix}"

    if not display_name or display_name.upper() == "NAN":
        display_name = "Santander"

    display_name = "Santander"
    # 3. Leer tabla de transacciones (fila 8 en Excel = índice 7 en pandas)
    df = df.iloc[7:].reset_index(drop=True)
    df.columns = df.iloc[0]
    df = df.iloc[1:].reset_index(drop=True)


    # 4. Procesamiento inicial
    df['DT_DATE'] = pd.to_datetime(df['Fecha operación'], format='%d/%m/%Y', errors='coerce')
    df["Cuenta"] = "Santander"
    df["Descripción"] = df["Concepto"].fillna("").astype(str).str.strip()
    df["Referencia"] = "NONE"
    df["BizumMensaje"] = None

    # 5. Aplicar análisis semántico
    analysis_df = pd.DataFrame(df["Descripción"].apply(lambda x: analyze_description(x, CATEGORY_RULES)).tolist())
    df = pd.concat([df.reset_index(drop=True), analysis_df], axis=1)

    # 6. Aplicar cuotas únicas
    df = apply_unique_cuotes(df)

    # 7. Ordenar por fecha y agregar segundos ficticios
    df['DT_DATE'] = pd.to_datetime(df['DT_DATE'])
    df = df.sort_values('DT_DATE', ascending=True)

    # Agregar segundos ficticios para transacciones del mismo día
    group_sizes = df.groupby(df['DT_DATE'].dt.date)['DT_DATE'].transform('count')
    rank_per_day = df.groupby(df['DT_DATE'].dt.date).cumcount()
    df['DT_DATE'] = (df['DT_DATE'] + pd.to_timedelta(rank_per_day, unit='s')).dt.strftime('%Y-%m-%d %H:%M:%S')

    # 8. Seleccionar columnas estándar
    df = df[
        [
            'DT_DATE',
            'Importe',
            'Saldo',
            'Cuenta',
            'Descripción',
            'Categoria',
            'Subcategoria',
            'BizumMensaje',
            'Referencia'
        ]
    ]

    # 9. Limpiar valores nulos y convertir importes
    df = df.replace({pd.NA: None, np.nan: None})
    for col in ['Importe', 'Saldo']:
        if col in df.columns:
            df[col] = pd.to_numeric(
                df[col]
                .astype(str)
                .str.replace(".", "")
                .str.replace(",", ".")
                .str.replace("€", "")
                .str.strip(),
                errors='coerce'
            )

    df = df.loc[df['Importe'].notna()]

    return df, account_identifier, display_name
