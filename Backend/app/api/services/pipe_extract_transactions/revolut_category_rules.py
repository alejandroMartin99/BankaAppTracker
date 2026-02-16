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
    
    # Restaurantes
    (r'RESTAURANTE|TABERNA|BAR|CERVECERIA|CAFETERIA|CONSUMICI|RTE ', 'Restaurantes', None),
    (r'DI CARLO', 'Restaurantes', 'Pizzeria Di Carlo'),
    (r'BURGER KING', 'Restaurantes', 'Burger King'),
    (r'DEEVENTOSS', 'Restaurantes', 'DeEventoss'),
    (r'DELIKA', 'Restaurantes', 'DELKIA CAFE'),
    (r'SIEMENS GETAFE', 'Restaurantes', 'Siemens CAFE'),
    (r'GARELOS', 'Restaurantes', 'FuranchoGarelos_Cena_empresa'),
    (r'LABRANZA', 'Restaurantes', 'La Labranza'),
    (r'MARIMER', 'Restaurantes', 'Marimer'),
    (r'MESON ORO Y PLATA', 'Restaurantes', 'INDRA_Meson_Oro_Y_Plata'),
    (r'PILAR AKANEYA', 'Restaurantes', 'PILAR AKANEYA'),
    (r'UBER EATS', 'Restaurantes', 'UBER EATS'),

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
    (r'TRANSFERENCIA INTERNA', 'Transferencia', 'interna'),
    (r'MYINVESTOR', 'Transferencia', 'MyInvestor'),
    (r'REVOLUT', 'Transferencia', 'Revolut'),
    (r'TRANSFERENCIA', 'Transferencia', None),

    # Banco
    (r'COMISION|LIQUIDACION INTERESES', 'banco', None),

    # INVERSIONES
    (r'KRAKEN', 'INVERSIONES', 'Kraken'),
    (r'REVOLUT DIGITAL ASSETS', 'INVERSIONES', 'Crypto_Revolut'),
]


def apply_unique_cuotes(df) -> pd.DataFrame:
    
    #======================================================
    # Compra Inmueble
    #======================================================
    
    # DONACIONES 
    df.loc[
        df['Descripción'].str.contains('DONACION PARTE ALEX  ORDEN: ALEJANDRO MARTIN IGLESIAS'),
        'Categoria'] = 'Compra_Inmueble'
    
    df.loc[
        df['Descripción'].str.contains('DONACION PARTE ALEX  ORDEN: ALEJANDRO MARTIN IGLESIAS'),
        'Subcategoria'] = 'Donacion_Alex'
    
    df.loc[
        df['Descripción'].str.contains('DONACION A LUCIA ARANZANA SANCHEZ'),
        'Categoria'] = 'Compra_Inmueble'
    
    df.loc[
        df['Descripción'].str.contains('DONACION A LUCIA ARANZANA SANCHEZ'),
        'Subcategoria'] = 'Donacion_Lucia'
    
    df.loc[
        df['Descripción'].str.contains('PAGO HIPOTECA  ORDEN: ALEJANDRO MARTIN IGLESIAS'),
        'Categoria'] = 'Compra_Inmueble'
    
    df.loc[
        df['Descripción'].str.contains('PAGO HIPOTECA  ORDEN: ALEJANDRO MARTIN IGLESIAS'),
        'Subcategoria'] = 'Aportación_Alex'
    
    df.loc[
        df['Descripción'].str.contains('APORTE LUCIA  ORDEN: LUCIA ARANZANA SANCHE'),
        'Categoria'] = 'Compra_Inmueble'
    
    df.loc[
        df['Descripción'].str.contains('APORTE LUCIA  ORDEN: LUCIA ARANZANA SANCHE'),
        'Subcategoria'] = 'Aportación_Lucia'
    
    # Prestamo IBERCAJA
    df.loc[
        df['Descripción'].str.contains('60103201400943H0000') &
        df['Referencia'].str.contains('40094370000') ,
        'Categoria'] = 'Compra_Inmueble'
    
    df.loc[
        df['Descripción'].str.contains('60103201400943H0000') &
        df['Referencia'].str.contains('40094370000') ,
        'Subcategoria'] = 'Prestamo_Ibercaja'
    
    # PAGOS DE HIPOTECA
    df.loc[
        (
            df['Descripción'].str.contains('CANCELACION HIPOTECA') |
            df['Descripción'].str.contains('TRANSMISION INMUEBLE')
            ),
        'Categoria'] = 'Compra_Inmueble'
    
    df.loc[(
            df['Descripción'].str.contains('CANCELACION HIPOTECA') |
            df['Descripción'].str.contains('TRANSMISION INMUEBLE')
            ),
        'Subcategoria'] = 'Transferencia_Marga'
    
    df.loc[
        df['Referencia']=='6010301400943',
        'Categoria'] = 'Compra_Inmueble'
    
    df.loc[
        df['Referencia']=='6010301400943',
        'Subcategoria'] = 'Provision_Fondos'
    
    df.loc[
        df['Concepto'].str.contains('COMISIONES Y GASTOS VARIOS'),
        'Categoria'] = 'Compra_Inmueble'
    
    df.loc[
        df['Concepto'].str.contains('COMISIONES Y GASTOS VARIOS'),
        'Subcategoria'] = 'Provision_Fondos'



    # Elimino la transferencia interna de Alex Personal a conjunta duplicada
    # PAGO HIPOTECA  6010303307165  -17323,00
    df = df.loc[
        ~(
            (df['Descripción'].str.contains('PAGO HIPOTECA')) &
            (df['Referencia'] == '6010303307165')
        )
    ]

    #======================================================
    # Eliminamos trasferencias duplciadas en personal
    #======================================================
    
    df.loc[
        df['Descripción'].str.contains('MOVIMIENTO CONJUNTA REVOLUT A CONJUNTA'),
        'Transferencia'] = 'Categoria'
    
    df.loc[
        df['Descripción'].str.contains('MOVIMIENTO CONJUNTA REVOLUT A CONJUNTA'),
        'Subcategoria'] = 'Inicio_Conjunta_Revolut'

    #======================================================
    # Eliminamos trasferencias duplciadas en personal
    #======================================================

    # Eliminamos Donacion a mi cuenta personal de Benigno Martin Garcia
    df = df.loc[
        ~(
            (df['Descripción'].str.contains('BENIGNO MARTIN GARCIA 06539399Q DONACION')) 
        )
    ]

    # Eliminamos ingresos inciales en personal de MyInvestor>> Se evalúan en conjunta.
    df = df.loc[
        ~(
            (df['Descripción'].str.contains('ALEJANDRO MARTIN IGLESIAS 70943328N')) &
            (df['Referencia'] == '653296441873')
        )
    ]

    df = df.loc[
        ~(
            (df['Descripción'].str.contains('ALEJANDRO MARTIN IGLESIAS 70943328N')) &
            (df['Referencia'] == '653186134379')
        )
    ]

    # Elimino donación de 55K de mi personal a conjunta
    df = df.loc[
        ~(
            (df['Descripción'].str.contains('DONACION PARTE ALEX')) &
            (df['Referencia'] == '6010303307165')
        )
    ]

    
    


    df = df.loc[
        ~(
            (df['Descripción'].str.contains('LUCIA ME ECHA LA BRONCA')) 
        )
    ]

    # df = df.loc[
    #     ~(
    #         (df['Descripción'].str.contains('LUCIA ME ECHA LA BRONCA')) &
    #         (df['Referencia'] == '6010303307165')
    #     )
    # ] 
    
    return df
