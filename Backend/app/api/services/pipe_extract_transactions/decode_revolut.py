import pandas as pd
import warnings
from app.api.services.pipe_extract_transactions.category_rules import analyze_description, CATEGORY_RULES
from app.api.services.account_config import get_revolut_default_name

warnings.filterwarnings("ignore", message="Workbook contains no default style*")


ACCOUNT_IDENTIFIER_REVOLUT = "revolut"


def main_decode_revolut(df: pd.DataFrame, account_name: str | None = None) -> tuple[pd.DataFrame, str, str]:
    """Decodifica extractos de Revolut y normaliza la tabla de transacciones.
    account_name: opcional. Si no se pasa, se usa config/accounts.yaml (revolut.default_name)
    Retorna: (DataFrame, account_identifier, display_name)
    """
    display_name = account_name or get_revolut_default_name()
    df["Cuenta"] = display_name
    df['Referencia'] = 'NONE'
    
    # 2. Normalizar descripción
    df["Descripción"] = df["Descripción"].fillna("").astype(str).str.strip()
    
    # 3. Aplicar análisis semántico usando la función compartida
    analysis_df = pd.DataFrame(
        df["Descripción"].apply(lambda x: analyze_description(x, CATEGORY_RULES)).tolist()
    )
    
    # 4. Renombrar columnas
    df = df.rename(columns={'Fecha de inicio': 'DT_DATE'})
    
    # 5. Concatenar DataFrames
    df = pd.concat([df.reset_index(drop=True), analysis_df], axis=1)
    
    # 6. Normalizar Saldo
    df['Saldo'] = df['Saldo'].fillna(0.0)
    
    # 7. Seleccionar y ordenar columnas
    df = df[[
        'DT_DATE',
        'Importe',
        'Saldo',
        'Cuenta',
        'Descripción',
        'Categoria',
        'Subcategoria',
        'BizumMensaje',
        'Referencia'
    ]].sort_values('DT_DATE')

    return df, ACCOUNT_IDENTIFIER_REVOLUT, display_name