import pandas as pd
import warnings
from app.api.services.pipe_extract_transactions.category_rules import analyze_description, CATEGORY_RULES
from app.api.services.account_config import get_revolut_default_name

warnings.filterwarnings("ignore", message="Workbook contains no default style*")


ACCOUNT_IDENTIFIER_REVOLUT = "revolut"

REVOLUT_HEADER_ES = [
    "Tipo",
    "Producto",
    "Fecha de inicio",
    "Fecha de finalización",
    "Descripción",
    "Importe",
    "Comisión",
    "Divisa",
    "State",
    "Saldo",
]

REVOLUT_EN_TO_ES = {
    "Type": "Tipo",
    "Product": "Producto",
    "Started Date": "Fecha de inicio",
    "Completed Date": "Fecha de finalización",
    "Description": "Descripción",
    "Amount": "Importe",
    "Fee": "Comisión",
    "Currency": "Divisa",
    "State": "State",
    "Balance": "Saldo",
}

_OUT_COLS = [
    "DT_DATE",
    "Importe",
    "Saldo",
    "Cuenta",
    "Descripción",
    "Categoria",
    "Subcategoria",
    "BizumMensaje",
    "Referencia",
]


def _clean_column_name(col) -> str:
    return str(col).strip().lstrip("\ufeff")


def _revolut_column_set(columns) -> set[str]:
    return {_clean_column_name(c) for c in columns}


def is_revolut_file(columns) -> bool:
    cols = _revolut_column_set(columns)
    if cols == set(REVOLUT_HEADER_ES) or cols == set(REVOLUT_EN_TO_ES):
        return True
    return set(REVOLUT_HEADER_ES).issubset(cols) or set(REVOLUT_EN_TO_ES).issubset(cols)


def normalize_revolut_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [_clean_column_name(c) for c in df.columns]
    rename = {k: v for k, v in REVOLUT_EN_TO_ES.items() if k in df.columns}
    if rename:
        return df.rename(columns=rename)
    return df


def prepare_revolut_dataframe(df: pd.DataFrame) -> pd.DataFrame | None:
    """Detecta Revolut (CSV con cabecera o Excel con cabecera en fila 1). None si no aplica."""
    df = df.copy()
    df.columns = [_clean_column_name(c) for c in df.columns]

    if is_revolut_file(df.columns):
        return normalize_revolut_columns(df)

    if len(df) == 0:
        return None

    first_row = [_clean_column_name(x) for x in df.iloc[0].tolist()]
    if is_revolut_file(first_row):
        out = df.iloc[1:].copy()
        out.columns = first_row
        return normalize_revolut_columns(out)

    return None


def main_decode_revolut(df: pd.DataFrame, account_name: str | None = None) -> tuple[pd.DataFrame, str, str]:
    """Decodifica extractos de Revolut y normaliza la tabla de transacciones.
    account_name: opcional. Si no se pasa, se usa config/accounts.yaml (revolut.default_name)
    Retorna: (DataFrame, account_identifier, display_name)
    """
    display_name = account_name or get_revolut_default_name()
    df = normalize_revolut_columns(df)
    df["Cuenta"] = display_name
    df["Referencia"] = "NONE"

    df["Descripción"] = df["Descripción"].fillna("").astype(str).str.strip()

    df = df.rename(columns={"Fecha de finalización": "DT_DATE"})
    ok = df["DT_DATE"].notna() & df["DT_DATE"].astype(str).str.strip().ne("")
    df = df.loc[ok].copy()
    if len(df) == 0:
        return pd.DataFrame(columns=_OUT_COLS), ACCOUNT_IDENTIFIER_REVOLUT, display_name

    # El análisis debe ir DESPUÉS de filtrar filas: si no, analysis_df tiene más filas que df y el
    # concat alinea por posición y rellena DT_DATE/Importe con NaN en las colas.
    analysis_df = pd.DataFrame(
        df["Descripción"].apply(lambda x: analyze_description(x, CATEGORY_RULES)).tolist()
    )

    df = pd.concat([df.reset_index(drop=True), analysis_df.reset_index(drop=True)], axis=1)

    df["Saldo"] = df["Saldo"].fillna(0.0)

    df = df[_OUT_COLS].sort_values("DT_DATE")

    df["DT_DATE"] = pd.to_datetime(df["DT_DATE"])
    rank_same_ts = df.groupby("DT_DATE").cumcount()
    df["DT_DATE"] = (df["DT_DATE"] + pd.to_timedelta(rank_same_ts, unit="s")).dt.strftime("%Y-%m-%d %H:%M:%S")

    return df, ACCOUNT_IDENTIFIER_REVOLUT, display_name
