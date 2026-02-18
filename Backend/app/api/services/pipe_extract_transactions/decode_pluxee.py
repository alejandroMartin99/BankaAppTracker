"""
Decodificador de extractos Pluxee (tarjeta restaurante / retribución flexible).
Identificación: celda que contiene "Pluxee Tarjeta Restaurante".
"""
import pandas as pd
import numpy as np
import warnings
from app.api.services.pipe_extract_transactions.category_rules import (
    CATEGORY_RULES,
    analyze_description,
)
from app.api.services.account_config import get_pluxee_default_name

warnings.filterwarnings("ignore", message="Workbook contains no default style*")

ACCOUNT_IDENTIFIER_PLUXEE = "pluxee"


def is_pluxee_file(df: pd.DataFrame) -> bool:
    """Identifica si el archivo es Pluxee: busca 'Pluxee Tarjeta Restaurante' (ej. celda C6)."""
    target = "Pluxee Tarjeta Restaurante"
    for r in range(min(20, len(df))):
        for c in range(min(15, df.shape[1])):
            try:
                if target in str(df.iloc[r, c] or "").strip():
                    return True
            except (IndexError, KeyError):
                pass
    return False


def main_decode_pluxee(df: pd.DataFrame, account_name: str | None = None) -> tuple[pd.DataFrame, str, str]:
    """
    Decodifica extractos Pluxee y normaliza la tabla de transacciones.
    Cabecera en fila 9: Fecha, Descripción, Importe. Saldo final en G6.
    Categoria: Restaurantes. Subcategoria: de category_rules (restaurantes).
    Retorna: (DataFrame, account_identifier, display_name)
    """
    if not is_pluxee_file(df):
        raise ValueError("No se identificó el archivo como Pluxee (falta 'Pluxee Tarjeta Restaurante')")

    display_name = account_name or get_pluxee_default_name()

    # 1. Saldo final en G6 (col 6 = G, fila 5 = 6 en 0-based)
    try:
        saldo_final_val = df.iloc[5, 6]
        saldo_final = pd.to_numeric(str(saldo_final_val).replace(",", "."), errors="coerce")
        if pd.isna(saldo_final):
            saldo_final = 0.0
    except (IndexError, KeyError):
        saldo_final = 0.0

    # 2. Cabecera en fila 9 (0-based: 8), datos desde fila 10 (0-based: 9)
    header_row = 8
    data_start = 9
    df_raw = df.iloc[data_start:].reset_index(drop=True)
    df_raw.columns = df.iloc[header_row].values

    # 3. Normalizar nombres de columnas (fecha/la fecha, descripción, importe)
    col_map = {}
    for c in df_raw.columns:
        cstr = str(c).strip().lower()
        if "fecha" in cstr or cstr == "la fecha":
            col_map[c] = "Fecha"
        elif "descripci" in cstr:
            col_map[c] = "Descripción"
        elif "importe" in cstr or cstr == "e importe":
            col_map[c] = "Importe"
    df_raw = df_raw.rename(columns=col_map)

    # 4. Seleccionar columnas disponibles y limpiar
    cols_needed = [c for c in ["Fecha", "Descripción", "Importe"] if c in df_raw.columns]
    if not cols_needed or "Importe" not in df_raw.columns:
        raise ValueError("Pluxee: no se encontraron columnas Fecha, Descripción o Importe")

    df_tx = df_raw[[c for c in cols_needed if c in df_raw.columns]].copy()
    df_tx["Importe"] = pd.to_numeric(
        df_tx["Importe"].astype(str).str.replace(",", ".", regex=False), errors="coerce"
    )
    df_tx = df_tx.dropna(subset=["Importe"])
    df_tx = df_tx[df_tx["Importe"] != 0]
    df_tx = df_tx.reset_index(drop=True)

    if df_tx.empty:
        return _empty_result(display_name)

    # 5. Fecha: DD/MM/YYYY
    df_tx["DT_DATE"] = pd.to_datetime(df_tx.get("Fecha", pd.Series(dtype=object)), format="%d/%m/%Y", errors="coerce")
    df_tx = df_tx.dropna(subset=["DT_DATE"])
    df_tx["Descripción"] = df_tx.get("Descripción", df_tx.get("Descripcion", pd.Series("", index=df_tx.index))).fillna("").astype(str).str.strip()
    df_tx["Cuenta"] = display_name
    df_tx["Referencia"] = "NONE"

    # 6. Calcular Saldo hacia atrás: última fila = saldo_final, anterior = saldo - importe
    df_tx = df_tx.sort_values("DT_DATE", ascending=False).reset_index(drop=True)
    saldos = [float(saldo_final)]
    for i in range(len(df_tx) - 1):
        imp = df_tx.iloc[i]["Importe"]
        saldos.append(saldos[-1] - imp)
    df_tx["Saldo"] = saldos

    # 7. Ordenar por fecha ascendente (cronológico)
    df_tx = df_tx.sort_values("DT_DATE").reset_index(drop=True)

    # 8. Categoría: cargas (positivos) = NOMINA/INDRA PLUXEE; gastos (negativos) = Restaurantes
    analysis_df = pd.DataFrame(
        df_tx["Descripción"].apply(lambda x: analyze_description(x, CATEGORY_RULES)).tolist()
    )
    df_tx = pd.concat([df_tx.reset_index(drop=True), analysis_df], axis=1)
    cargas = df_tx["Importe"] > 0
    df_tx.loc[cargas, ["Categoria", "Subcategoria"]] = ["Nómina", "INDRA PLUXEE"]
    df_tx.loc[~cargas, "Categoria"] = "Restaurantes"
    # Subcategoria para gastos: de category_rules o descripción truncada
    def _subcat(row):
        if row["Importe"] > 0:
            return "INDRA PLUXEE"
        sc = row.get("Subcategoria")
        desc = (row.get("Descripción") or "").strip()
        if sc and str(sc) != "None" and str(sc) != "Restaurantes":
            return sc
        return (desc[:50] + "…") if len(desc) > 50 else desc if desc else "Restaurante"

    df_tx["Subcategoria"] = df_tx.apply(_subcat, axis=1)
    df_tx["BizumMensaje"] = None

    # 9. Añadir hh:mm:ss ficticias por orden dentro de cada día (como Ibercaja)
    df_tx["DT_DATE"] = pd.to_datetime(df_tx["DT_DATE"])
    rank_per_day = df_tx.groupby(df_tx["DT_DATE"].dt.date).cumcount()
    df_tx["DT_DATE"] = (df_tx["DT_DATE"] + pd.to_timedelta(rank_per_day, unit="s")).dt.strftime("%Y-%m-%d %H:%M:%S")

    # 10. Columnas finales
    df_tx = df_tx[
        ["DT_DATE", "Importe", "Saldo", "Cuenta", "Descripción", "Categoria", "Subcategoria", "BizumMensaje", "Referencia"]
    ]
    df_tx = df_tx.replace({pd.NA: None, np.nan: None})

    return df_tx, ACCOUNT_IDENTIFIER_PLUXEE, display_name


def _empty_result(display_name: str) -> tuple[pd.DataFrame, str, str]:
    """Devuelve DataFrame vacío con columnas correctas."""
    return (
        pd.DataFrame(
            columns=["DT_DATE", "Importe", "Saldo", "Cuenta", "Descripción", "Categoria", "Subcategoria", "BizumMensaje", "Referencia"]
        ),
        ACCOUNT_IDENTIFIER_PLUXEE,
        display_name,
    )
