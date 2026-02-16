import re
import pandas as pd
from typing import Optional, Tuple, Dict

CATEGORY_RULES = [
    # Nómina
    (r'INDRA', 'nomina', 'INDRA'),
    (r'NOMINA', 'nomina', 'EX-EMPRESA'),

    # Bizum
    (r'BIZUM', 'bizum', None),

    # Suministros
    (r'RECIBO AGUA|CANAL DE ISABEL', 'Suministros', 'Agua'),
    (r'RECIBO LUZ|IBERDROLA|ENDESA|NATURGY|REPSOL LUZ', 'Suministros', 'Luz'),
    (r'RECIBO GAS|GAS NATURAL|COMERCIALIZADORA RE', 'Suministros', 'Gas'),
    (r'RECIBO TELEFON|MOVISTAR|VODAFONE|ORANGE|YOIGO|MASMOVIL', 'Suministros', 'Telefono'),
    (r'COMUNIDAD PROPIETARIOS|COM\. PROP', 'Suministros', 'Comunidad'),

    # BienEstar
    (r'WELLHUB|DREAMFIT|DEPORTIVO', 'BienEstar', 'Gimnasio'),
    (r'BEARBERO EMBAJADORES', 'BienEstar', 'Peluquero'),
    (r'CURSOR', 'BienEstar', 'Cursor'),
    (r'DOUGLAS', 'BienEstar', 'Douglas'),
    (r'DRUNI', 'BienEstar', 'Druni'),
    (r'NOTINO', 'BienEstar', 'Notino'),
    (r'PRIMOR', 'BienEstar', 'Primor'),
    (r'HIERBA EN FLOR', 'BienEstar', 'Flores_Lucia'),

    # OCIO
    (r'KINEPOLIS', 'OCIO', 'Kinepolis'),

    # Seguros
    (r'IBERVIDA', 'Seguros', 'Vida'),
    (r'OPERACION CSV', 'Seguros', 'Hogar'),
    (r'SEGURO', 'Seguros', None),

    # Vivienda
    (r'HIPOTECA|OPERACION PRESTAMO-CREDITO-AVAL', 'Vivienda', 'Hipoteca'),

    # Transporte
    (r'REPSOL|CEPSA|BP |SHELL|GASOLINER', 'Transporte', 'Gasolina'),
    (r'TPV VALDEBERNARDO', 'Transporte', 'Gasolina'),
    (r'VALDEBERNARDO', 'Transporte', 'Gasolina'),
    (r'GASLOWCOST', 'Transporte', 'Gasolina'),
    (r'PETROPRIX', 'Transporte', 'Gasolina'),
    (r'TAXI|BLA BLA', 'Transporte', 'Taxi'),
    (r'CABIFY', 'Transporte', 'CABIFY'),
    (r'UBER', 'Transporte', 'UBER'),
    (r'RENFE|METRO|EMT|AUTOBUS', 'Transporte', 'Transporte Público'),
    (r'EASYPARK', 'Transporte', 'EASYPARK'),
    (r'PARKING', 'Transporte', 'PARKING'),
    (r'AMOVENS', 'Transporte', 'Amovens_Alquiler_Furgo'),
    (r'METRO', 'Transporte', 'Metro'),
    (r'SEITT', 'Transporte', 'Peaje'),
    (r'VIA-T', 'Transporte', 'Peaje'),

    # Hogar
    (r'JYSK', 'Hogar', 'JYSK'),
    (r'IKEA', 'Hogar', 'IKEA'),
    (r'LEROY', 'Hogar', 'LEROY MERLIN'),
    (r'HIPERHOGAR', 'Hogar', None),
    (r'AMAZON', 'Hogar', 'Amazon'),
    (r'HOGARDEXTER', 'Hogar', 'Hogardexter'),


    # Supermercados
    (r'CARREF', 'Supermercado', 'Carrefour'),
    (r'MERCADONA', 'Supermercado', 'Mercadona'),
    (r'LIDL', 'Supermercado', 'Lidl'),
    (r'ALDI', 'Supermercado', 'Aldi'),
    (r'DIA ', 'Supermercado', 'Dia'),
    (r'AUCHAN ', 'Supermercado', 'Alcampo'),
    (r'ALCAMPO ', 'Supermercado', 'Alcampo'),
    (r'AHORRAMAS ', 'Supermercado', 'Ahorramas'),
    (r'LA VIDA VERDE ', 'Supermercado', 'General'),

    
    # Restaurantes
    (r'RESTAURANTE|TABERNA|BAR|CERVECERIA|CAFETERIA|CONSUMICI|RTE ', 'Restaurantes', None),
    (r'DI CARLO', 'Restaurantes', 'Pizzeria Di Carlo'),
    (r'BURGER KING', 'Restaurantes', 'Burger King'),
    (r'DEEVENTOSS', 'Restaurantes', 'DeEventoss'),
    (r'DELIKIA', 'Restaurantes', 'DELIKIA CAFE'),
    (r'SIEMENS GETAFE', 'Restaurantes', 'Siemens CAFE'),
    (r'GARELOS', 'Restaurantes', 'Cena EMPRESA GARELOS'),
    (r'LABRANZA', 'Restaurantes', 'La Labranza'),
    (r'MARIMER', 'Restaurantes', 'Marimer'),
    (r'MESON ORO Y PLATA', 'Restaurantes', 'INDRA_Meson_Oro_Y_Plata'),
    (r'PILAR AKANEYA', 'Restaurantes', 'PILAR AKANEYA'),
    (r'UBER EATS', 'Restaurantes', 'UBER EATS'),
    (r'TASTE', 'Restaurantes', 'TOY&TASTE'),

    # Ropa
    (r'ZARA', 'Ropa', 'ZARA'),
    (r'H&M', 'Ropa', 'H&M'),
    (r'PULL', 'Ropa', 'PULL&BEAR'),
    (r'BERSHKA', 'Ropa', 'BERSHKA'),
    (r'MANGO', 'Ropa', 'MANGO'),
    (r'PRIMARK', 'Ropa', 'PRIMARK'),
    (r'JACK JONES', 'Ropa', 'JACK & JONES'),
    (r'ALVARO MORENO', 'Ropa', 'ALVARO MORENO'),
    (r'SINGULARU', 'Ropa', 'Singularu'),
    (r'UNIQLO', 'Ropa', 'UNIQLO'),


    # Transferencias
    (r'TRANSFERENCIA INTERNA', 'Transferencia', 'Interna_Ibercaja'),
    (r'MYINVESTOR', 'Transferencia', 'MyInvestor'),
    (r'REVOLUT\*\*', 'Transferencia', 'Revolut'),
    (r'ENVIADA DESDE REVOLUT', 'Transferencia', 'Revolut'),
    (r'TRANSFERENCIA', 'Transferencia', None),
    (r'UNA RECARGA DE APPLE PAY CON', 'Transferencia', 'Recarga'),
    (r'RETIRADA DE EFECTIVO', 'Transferencia', 'CAJERO'),

    # Banco
    (r'COMISION|LIQUIDACION INTERESES', 'banco', None),

    # INVERSIONES
    (r'KRAKEN', 'INVERSIONES', 'Kraken'),
    (r'REVOLUT DIGITAL ASSETS', 'INVERSIONES', 'Crypto_Revolut'),
]

def categorize_transaction(description: str, category_rules) -> Tuple[str, Optional[str]]:
    """Categoriza una transacción según las reglas definidas"""
    desc = description.upper()
    for pattern, category, subcategory in category_rules:
        if re.search(pattern, desc):
            return category, subcategory
    return "otros", None


def parse_restaurante(description: str) -> Optional[str]:
    """Extrae el nombre del restaurante de la descripción"""
    match = re.search(r'(RESTAURANTE|TABERNA|BAR|CERVECERIA|CAFETERIA)\s+(.+)$', description, re.IGNORECASE)
    return match.group(2).strip() if match else None


def parse_transferencia(description: str) -> Optional[str]:
    """Extrae información de la contraparte en transferencias"""
    for pattern in [r'desde\s+([^,]+)', r'ORDEN:\s*([^,]+)', r'BENEF:\s*([^,]+)']:
        match = re.search(pattern, description, re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return None


def parse_bizum(description: str) -> Tuple[Optional[str], Optional[str]]:
    """Extrae contacto y mensaje de transacciones Bizum"""
    contact = message = None
    
    m = re.search(r'(BENEF|ORDEN):\s*([^,]+)', description, re.IGNORECASE)
    if m:
        contact = m.group(2).strip()
    
    msg = re.search(r'BIZUM\s+(?:CARGO|ABONO).*?\s(.+?)\s*\.', description, re.IGNORECASE)
    if msg:
        message = msg.group(1).strip()
    
    return contact, message


def analyze_description(description: str, category_rules) -> Dict[str, Optional[str]]:
    """Analiza la descripción y extrae categoría, subcategoría y otros datos"""
    category, subcategory = categorize_transaction(description, category_rules)
    result = {
        "Categoria": category,
        "Subcategoria": subcategory,
        "Contraparte": None,
        "BizumMensaje": None,
    }
    
    if category == "bizum":
        contact, message = parse_bizum(description)
        result["Contraparte"] = result["Subcategoria"] = contact
        result["BizumMensaje"] = message

    elif category == "restaurantes" and not subcategory:
        name = parse_restaurante(description)
        result["Subcategoria"] = name

    elif category == "Transferencia" and not subcategory:
        cp = parse_transferencia(description)
        result["Contraparte"] = cp
        if not subcategory:
            result["Subcategoria"] = cp
    
    return result


def apply_unique_cuotes(df: pd.DataFrame) -> pd.DataFrame:
    """Aplica reglas específicas de categorización y elimina duplicados"""
    
    # Crear máscaras booleanas para todas las condiciones
    desc = df['Descripción'].str
    ref = df['Referencia']
    concepto = df['Concepto'].str
    
    #======================================================
    # Compra Inmueble - Asignaciones
    #======================================================
    rules = [
        (desc.contains('DONACION PARTE ALEX  ORDEN: ALEJANDRO MARTIN IGLESIAS', na=False), 'Compra_Inmueble', 'Donacion_Alex'),
        (desc.contains('DONACION A LUCIA ARANZANA SANCHEZ', na=False), 'Compra_Inmueble', 'Donacion_Lucia'),
        (desc.contains('PAGO HIPOTECA  ORDEN: ALEJANDRO MARTIN IGLESIAS', na=False), 'Compra_Inmueble', 'Aportación_Alex'),
        (desc.contains('APORTE LUCIA  ORDEN: LUCIA ARANZANA SANCHE', na=False), 'Compra_Inmueble', 'Aportación_Lucia'),
        (desc.contains('60103201400943H0000', na=False) & ref.str.contains('40094370000', na=False), 'Compra_Inmueble', 'Prestamo_Ibercaja'),
        (desc.contains('CANCELACION HIPOTECA', na=False) | desc.contains('TRANSMISION INMUEBLE', na=False), 'Compra_Inmueble', 'Transferencia_Marga'),
        (ref == '6010301400943', 'Compra_Inmueble', 'Provision_Fondos'),
        (concepto.contains('COMISIONES Y GASTOS VARIOS', na=False), 'Compra_Inmueble', 'Provision_Fondos'),
        (desc.contains('MOVIMIENTO CONJUNTA REVOLUT A CONJUNTA', na=False), 'Transferencia', 'Inicio_Conjunta_Revolut'),
    ]
    
    for mask, categoria, subcategoria in rules:
        df.loc[mask, ['Categoria', 'Subcategoria']] = [categoria, subcategoria]
    
    #======================================================
    # Eliminar transacciones duplicadas/innecesarias
    #======================================================
    eliminaciones = [
        desc.contains('PAGO HIPOTECA', na=False) & (ref == '6010303307165'),
        desc.contains('BENIGNO MARTIN GARCIA 06539399Q DONACION', na=False),
        desc.contains('ALEJANDRO MARTIN IGLESIAS 70943328N', na=False) & (ref == '653296441873'),
        desc.contains('ALEJANDRO MARTIN IGLESIAS 70943328N', na=False) & (ref == '653186134379'),
        desc.contains('DONACION PARTE ALEX', na=False) & (ref == '6010303307165'),
        desc.contains('LUCIA ME ECHA LA BRONCA', na=False),
    ]
    
    mask_eliminar = pd.Series([False] * len(df), index=df.index)
    for cond in eliminaciones:
        mask_eliminar |= cond
    
    return df[~mask_eliminar]