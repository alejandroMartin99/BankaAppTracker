# Santander Transaction Decoder Design

**Date:** 2026-04-25  
**Project:** BankaAppTracker  
**Feature:** Add support for parsing Santander bank transaction exports

## Overview

Add a new decoder module `decode_santander.py` to parse Santander bank statement exports and integrate them into the existing transaction import pipeline, following the established pattern used by Ibercaja and Revolut decoders.

## File Format

Santander export Excel files contain:
- **Rows 1-7:** Metadata (Cuenta, Titular, Fecha, Saldo, etc.)
- **Row 8:** Column headers
- **Row 9+:** Transaction data

### Metadata Locations
- `C1` = "Cuenta" (label)
- `D1` = IBAN (account number)
- `C3` = "Titular" (label)
- `D3` = Name of account holder
- `A6` = "Movimientos" (transaction section marker)

### Transaction Columns (Row 8)
```
Fecha operación | Fecha valor | Concepto | Importe | Saldo | Divisa
```

## Detection Strategy

Identify Santander files by checking:
- Cell `A6` contains "Movimientos" (unique to Santander format)

This is the primary detection mechanism in `main.py`.

## Implementation Details

### New Module: `decode_santander.py`

**Function signature:**
```python
def main_decode_santander(df: pd.DataFrame, account_map: dict | None = None) -> tuple[pd.DataFrame, str, str]
```

**Returns:**
- `DataFrame`: Normalized transactions with columns: DT_DATE, Importe, Saldo, Cuenta, Descripción, Categoria, Subcategoria, BizumMensaje, Referencia
- `account_identifier`: String format `"santander_XXXXXXX"` (last 7 digits of IBAN without spaces)
- `display_name`: Account holder name from D3 (e.g., "MARTIN GARCIA BENIGNO")

### Processing Steps

1. **Extract metadata:**
   - Read IBAN from D1, remove spaces, extract last 7 digits
   - Read account holder name from D3
   - Generate `account_identifier = f"santander_{iban_suffix}"`

2. **Extract transaction table:**
   - Skip rows 1-7 (metadata)
   - Set row 8 as column headers
   - Process rows 9+

3. **Data normalization:**
   - Parse `Fecha operación` as date (format: DD/MM/YYYY)
   - Convert `Importe` and `Saldo` to float (handle comma as decimal)
   - Fill `Cuenta` column with `display_name`
   - Rename `Concepto` to `Descripción`
   - Set `Referencia` to "NONE" (not provided in Santander format)
   - Set `BizumMensaje` to empty/null (not provided in Santander format)

4. **Category extraction:**
   - Apply `analyze_description()` with existing `CATEGORY_RULES` (same as Ibercaja/Revolut)
   - No Santander-specific categorization rules at this stage

5. **Time ordering:**
   - Add fictional seconds offset when multiple transactions occur on same date
   - Sort by date ascending

### Integration with main.py

Update `main_file_parser()` in `main.py`:

```python
# After Pluxee detection, add Santander detection:
if df.iloc[5, 0].strip().upper() == "MOVIMIENTOS":  # A6
    print("Archivo identificado como SANTANDER")
    df_transactions, account_identifier, display_name = main_decode_santander(df)
    source_type = "Santander"
```

### Output Columns

Standard columns matching existing decoders:
```
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
```

## Data Flow

```
Santander Excel → main_decode_santander() → normalized DataFrame
                  ↓
              analyze_description()
              ↓
         CATEGORY_RULES application
         ↓
    Rename columns (DT_DATE, Importe, etc.)
    ↓
return (DataFrame, "santander_XXXXXXX", "MARTIN GARCIA BENIGNO")
```

## Error Handling

- Raise `ValueError` if IBAN cannot be extracted (no match pattern or missing D1)
- Raise `ValueError` if "Movimientos" not found in A6 during detection
- Warn if Titular (D3) is empty or None (use placeholder)
- Handle invalid date formats with `pd.to_datetime(..., errors='coerce')`
- Handle non-numeric Importe/Saldo by converting to NaN

## Testing Considerations

- Verify IBAN parsing (last 7 digits) with provided test file
- Verify metadata extraction (account holder name, account identifier)
- Verify transaction table alignment (row 8 headers, row 9+ data)
- Verify date format parsing (DD/MM/YYYY)
- Verify decimal/currency formatting (comma as decimal)
- Verify categorization against CATEGORY_RULES
- Verify no duplicates in transaction_id generation

## Future Enhancements (out of scope)

- Santander-specific categorization rules
- Support for multiple account types
- Support for international (non-ES) IBANs
- CSVimport format support

## Files to Modify

1. **Create:** `Backend/app/api/services/pipe_extract_transactions/decode_santander.py`
2. **Update:** `Backend/app/api/services/pipe_extract_transactions/main.py` (add detection + import)

## Backwards Compatibility

No breaking changes. New decoder is purely additive; existing Ibercaja, Revolut, and Pluxee functionality unchanged.
