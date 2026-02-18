import re
import pandas as pd
import numpy as np
import warnings
from app.api.services.pipe_extract_transactions.category_rules import (
    CATEGORY_RULES,
    apply_unique_cuotes,
    analyze_description,
)
from app.api.services.account_config import get_ibercaja_account_map

warnings.filterwarnings("ignore", message="Workbook contains no default style*")


def main_decode_ibercaja(df: pd.DataFrame, account_map: dict | None = None) -> tuple[pd.DataFrame, str, str]:
    """Decodifica extractos de Ibercaja y normaliza la tabla de transacciones.
    account_map: opcional, mapeo {iban_completo: nombre}. Si no se pasa, se carga de config/accounts.yaml
    Retorna: (DataFrame, account_identifier, display_name)
    """
    account_map = account_map or get_ibercaja_account_map()

    # 1. Detectar número de cuenta
    account_number = None
    suffix = None
    for i in range(min(5, len(df))):
        row_text = " ".join(str(v) for v in df.iloc[i].values if pd.notna(v))
        match = re.search(r"20859254\*+(\d{6})", row_text)
        if match:
            suffix = match.group(1)
            account_number = f"20859254******{suffix}"
            break

    if not account_number:
        raise ValueError("No se pudo detectar el número de cuenta Ibercaja")

    account_identifier = f"ibercaja_{suffix}"
    display_name = account_map.get(account_number) if account_map else None
    if not display_name:
        display_name = f"Cuenta {suffix}"

    # 2. Leer tabla de transacciones
    df = df.iloc[6:].reset_index(drop=True)
    df.columns = df.iloc[0]
    df = df.iloc[1:].reset_index(drop=True)
    
    # 3. Procesamiento inicial
    df['DT_DATE'] = pd.to_datetime(df['Fecha Operacion'], format='%d/%m/%Y', errors='coerce')
    df["Cuenta"] = display_name
    df["Descripción"] = df["Descripción"].fillna("").astype(str).str.strip()
    
    # 4. Aplicar análisis semántico
    analysis_df = pd.DataFrame(df["Descripción"].apply(lambda x: analyze_description(x, CATEGORY_RULES)).tolist())
    df = pd.concat([df.reset_index(drop=True), analysis_df], axis=1)
    
    # 5. Reglas de categorización específicas (usando máscaras booleanas)
    transferencia_interna = df['Concepto'] == 'TRANSFERENCIA INTERNA'
    transferencia_otra = (df['Concepto'] == 'TRANSFERENCIA OTRA ENTIDAD') & (df['Categoria'] == 'None')
    lucia_transfer = transferencia_interna & df['Descripción'].str.contains('LUCIA ARANZANA SANCHEZ', na=False)
    liquidacion = df['Concepto'] == 'LIQUIDACION INTERESES DE LA CUENTA'
    prestamo = df['Concepto'] == 'OPERACION PRESTAMO-CREDITO-AVAL'
    
    df.loc[transferencia_interna, ['Categoria', 'Subcategoria']] = ['Transferencia', 'Aportacion_Conjunta_Alex']
    df.loc[transferencia_otra, ['Categoria', 'Subcategoria']] = ['Transferencia', 'Interna']
    df.loc[lucia_transfer, ['Categoria', 'Subcategoria']] = ['Transferencia', 'Aportacion_Conjunta_Lucia']
    df.loc[liquidacion, ['Categoria', 'Subcategoria']] = ['Banco', 'Intereses']
    df.loc[prestamo, ['Categoria', 'Subcategoria']] = ['Vivienda', 'Hipoteca']
    
    # 6. Aplicar cuotas únicas
    df = apply_unique_cuotes(df)
    
    # 7. Selección y ordenación de columnas
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
    ].sort_values('DT_DATE')
    
    # 8. Añadir hh:mm:ss ficticias por orden dentro de cada día (para ordenar; Revolut ya trae hora real)
    df['DT_DATE'] = pd.to_datetime(df['DT_DATE'])
    rank_per_day = df.groupby(df['DT_DATE'].dt.date).cumcount()
    df['DT_DATE'] = (df['DT_DATE'] + pd.to_timedelta(rank_per_day, unit='s')).dt.strftime('%Y-%m-%d %H:%M:%S')
    df = df.replace({pd.NA: None, np.nan: None})
    
    # Convertir importes
    for col in ['Importe', 'Saldo']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col].astype(str).str.replace(",", "."), errors='coerce')

    return df, account_identifier, display_name