import pandas as pd
import warnings
from app.api.services.pipe_extract_transactions.category_rules import analyze_description, CATEGORY_RULES
from app.api.services.account_config import get_revolut_default_name

warnings.filterwarnings("ignore", message="Workbook contains no default style*")


ACCOUNT_IDENTIFIER_REVOLUT = "revolut"

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


def main_decode_revolut(df: pd.DataFrame, account_name: str | None = None) -> tuple[pd.DataFrame, str, str]:
    """Decodifica extractos de Revolut y normaliza la tabla de transacciones.
    account_name: opcional. Si no se pasa, se usa config/accounts.yaml (revolut.default_name)
    Retorna: (DataFrame, account_identifier, display_name)
    """
    display_name = account_name or get_revolut_default_name()
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
