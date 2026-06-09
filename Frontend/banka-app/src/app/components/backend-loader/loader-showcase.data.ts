export interface LoaderShowcaseSlide {
  image: string;
  title: string;
  description: string;
  tag: string;
}

/** Mockup móvil incluido en las capturas (mayoría 912×1854). */
export const CAPTURE_NATIVE_WIDTH = 912;
export const CAPTURE_NATIVE_HEIGHT = 1854;

/** Capturas en `public/captures/` — carrusel del splash inicial. */
export const LOADER_SHOWCASE_SLIDES: LoaderShowcaseSlide[] = [
  {
    image: '/captures/BA_Gastos.png',
    title: 'Todos tus movimientos',
    description: 'Consulta gastos e ingresos por cuenta, categoría y fecha en un solo listado.',
    tag: 'Gastos',
  },
  {
    image: '/captures/BAP_Resumen.png',
    title: 'Resumen financiero',
    description: 'Balance, evolución del patrimonio y vista global de tus cuentas de un vistazo.',
    tag: 'Resumen',
  },
  {
    image: '/captures/BA_Resumen_exp.png',
    title: 'Detalle por categoría',
    description: 'Despliega ingresos y gastos por categoría y subcategoría en el resumen.',
    tag: 'Resumen',
  },
  {
    image: '/captures/BA_Charts.png',
    title: 'Gráficos de gasto e ingreso',
    description: 'Compara mes a mes cuánto entra y cuánto sale frente a tu media habitual.',
    tag: 'Gráficos',
  },
  {
    image: '/captures/BA_Charts_CAT.png',
    title: 'Análisis por categoría',
    description: 'Descubre en qué categorías gastas más y cómo se desvían del mes anterior.',
    tag: 'Gráficos',
  },
  {
    image: '/captures/BA_Charts_SUBCAT.png',
    title: 'Evolución por subcategoría',
    description: 'Líneas mensuales de las subcategorías que más pesan en una categoría.',
    tag: 'Gráficos',
  },
  {
    image: '/captures/BA_Charts_SUBCAT_Details.png',
    title: 'Drill-down subcategoría',
    description: 'Pulsa una subcategoría y mira cada gasto frente a su media unitaria.',
    tag: 'Gráficos',
  },
  {
    image: '/captures/BA_Compartido_open.png',
    title: 'Gastos compartidos',
    description: 'Reparte gastos del hogar entre cuentas propias y de tu pareja, mes a mes.',
    tag: 'Compartidos',
  },
  {
    image: '/captures/BA_Inversion.png',
    title: 'Cartera de inversión',
    description: 'Sigue el valor de tus posiciones, rentabilidad y peso de cada activo.',
    tag: 'Inversión',
  },
  {
    image: '/captures/BA_Inversion_Detail.png',
    title: 'Detalle de posición',
    description: 'Histórico de compras, valor actual y evolución de cada fondo o ETF.',
    tag: 'Inversión',
  },
  {
    image: '/captures/BA_Inversion_ISIN.png',
    title: 'Alta por ISIN',
    description: 'Añade fondos buscando por ISIN con datos de mercado actualizados.',
    tag: 'Inversión',
  },
  {
    image: '/captures/BA_Hipoteca.png',
    title: 'Panel de hipoteca',
    description: 'Capital pendiente, cuotas restantes y curva de amortización de tu préstamo.',
    tag: 'Hipotecas',
  },
  {
    image: '/captures/BA_Hipoteca_Simu.png',
    title: 'Simulador de hipoteca',
    description: 'Calcula cuota, intereses totales y compara escenarios de tipo fijo o variable.',
    tag: 'Hipotecas',
  },
  {
    image: '/captures/BA_Hipoteca_Amortizacion.png',
    title: 'Plan de amortización',
    description: 'Visualiza cómo baja el capital pendiente con pagos extra o cuotas anticipadas.',
    tag: 'Hipotecas',
  },
  {
    image: '/captures/BA_Salario_Neto_Bruto.png',
    title: 'Salario neto y bruto',
    description: 'Estima tu nómina neta a partir del bruto con retenciones y cotizaciones.',
    tag: 'Herramientas',
  },
  {
    image: '/captures/BA_Pagos_Recurrentes.png',
    title: 'Pagos recurrentes',
    description: 'Detecta suscripciones y cargos fijos para no llevarte sorpresas a fin de mes.',
    tag: 'Gastos',
  },
];
