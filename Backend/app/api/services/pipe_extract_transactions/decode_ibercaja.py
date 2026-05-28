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

    # 1. Detectar número de cuenta (evitar hardcode de base Ibercaja)
    account_number = None
    suffix = None
    known_masked_accounts = [str(k).strip() for k in (account_map or {}).keys() if str(k).strip()]
    base_candidates = [k[:-6] for k in known_masked_accounts if len(k) >= 6]
    base_pattern = base_candidates[0] if base_candidates else ""

    def _extract_account_parts(text: str) -> tuple[str | None, str | None]:
        if not text:
            return None, None
        # Caso típico en extracto: 8 dígitos + asteriscos + 6 dígitos
        m_mask = re.search(r"(\d{8})\*+(\d{6})", text)
        if m_mask:
            return f"{m_mask.group(1)}******", m_mask.group(2)
        # IBAN ES + 24 chars (tomamos últimos 6 dígitos)
        m_iban = re.search(r"\bES\d{22}\b", text.replace(" ", ""))
        if m_iban:
            digits = re.sub(r"\D", "", m_iban.group(0))
            if len(digits) >= 6:
                return None, digits[-6:]
        # Fallback: secuencias largas de dígitos en cabecera (CCC/IBAN parcial)
        for raw in re.findall(r"\d{10,24}", text):
            if len(raw) >= 6:
                return None, raw[-6:]
        return None, None

    for i in range(min(15, len(df))):
        row_text = " ".join(str(v) for v in df.iloc[i].values if pd.notna(v))
        detected_base, candidate_suffix = _extract_account_parts(row_text)
        if candidate_suffix:
            suffix = candidate_suffix
            if detected_base:
                base_pattern = detected_base
            account_number = f"{base_pattern}{suffix}"
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

    
    # 4. Procesamiento inicial
    df['DT_DATE'] = pd.to_datetime(df['Fecha Operacion'], format='%d/%m/%Y', errors='coerce')
    df["Cuenta"] = display_name
    df["Descripción"] = df["Descripción"].fillna("").astype(str).str.strip()
    
    # 5. Aplicar análisis semántico
    analysis_df = pd.DataFrame(df["Descripción"].apply(lambda x: analyze_description(x, CATEGORY_RULES)).tolist())
    df = pd.concat([df.reset_index(drop=True), analysis_df], axis=1)
    
    # 6. Reglas de categorización específicas (usando máscaras booleanas)
    transferencia_interna = df['Concepto'] == 'TRANSFERENCIA INTERNA'
    transferencia_otra = (df['Concepto'] == 'TRANSFERENCIA OTRA ENTIDAD') & (df['Categoria'] == 'None')
    lucia_transfer = transferencia_interna & df['Descripción'].str.contains('ARANZANA SANCHEZ', na=False)
    liquidacion = df['Concepto'] == 'LIQUIDACION INTERESES DE LA CUENTA'
    prestamo = df['Concepto'] == 'OPERACION PRESTAMO-CREDITO-AVAL'
    
    df.loc[transferencia_interna, ['Categoria', 'Subcategoria']] = ['Transferencia', 'Aportacion_Conjunta_Alex']
    df.loc[transferencia_otra, ['Categoria', 'Subcategoria']] = ['Transferencia', 'Interna']
    df.loc[lucia_transfer, ['Categoria', 'Subcategoria']] = ['Transferencia', 'Aportacion_Conjunta_Lucia']
    df.loc[liquidacion, ['Categoria', 'Subcategoria']] = ['Banco', 'Intereses']
    df.loc[prestamo, ['Categoria', 'Subcategoria']] = ['Vivienda', 'Hipoteca']
    
    # 7. Aplicar cuotas únicas
    df = apply_unique_cuotes(df)
    
    # 8. Por cada día (DT_DATE): ordenar por "Nº de Orden" ascendente (la última tiene número más bajo).
    #    Luego asignar horas ficticias según ese orden (0s, 1s, 2s...).
    df['DT_DATE'] = pd.to_datetime(df['DT_DATE'])
    df = df.sort_values(['DT_DATE', 'Nº Orden'], ascending=[False, True])

    # Contar cuántos hay por día para invertir el offset
    group_sizes = df.groupby(df['DT_DATE'].dt.date)['DT_DATE'].transform('count')
    rank_per_day = df.groupby(df['DT_DATE'].dt.date).cumcount()

    # El primero (Nº de Orden menor) recibe el offset más alto → aparece último en orden asc, primero en desc
    df['DT_DATE'] = (df['DT_DATE'] + pd.to_timedelta(group_sizes - rank_per_day - 1, unit='s')).dt.strftime('%Y-%m-%d %H:%M:%S')
    
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
    # 11. Limpiar valores nulos y convertir importes
    df = df.replace({pd.NA: None, np.nan: None})
    for col in ['Importe', 'Saldo']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col].astype(str).str.replace(",", "."), errors='coerce')

    return df, account_identifier, display_name