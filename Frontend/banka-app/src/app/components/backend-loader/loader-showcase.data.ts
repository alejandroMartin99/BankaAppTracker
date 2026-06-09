export interface LoaderShowcaseSlide {
  image: string;
  title: string;
  description: string;
  tag: string;
}

/** Resolución nativa de las capturas actuales (1×). Para retina: ≥714px ancho. */
export const CAPTURE_NATIVE_WIDTH = 357;
export const CAPTURE_NATIVE_HEIGHT = 613;

export function captureSrc2x(src: string): string {
  return src.replace(/\.png$/i, '@2x.png');
}

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
    title: 'Exporta tu resumen',
    description: 'Genera informes del período para compartir o archivar fuera de la app.',
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
    image: '/captures/BA_Charts_evol.png',
    title: 'Evolución mensual',
    description: 'Abre el detalle de una categoría y sigue su tendencia mes a mes.',
    tag: 'Gráficos',
  },
  {
    image: '/captures/BA_Compartido.png',
    title: 'Gastos compartidos',
    description: 'Reparte gastos del hogar entre cuentas propias y de tu pareja.',
    tag: 'Compartidos',
  },
  {
    image: '/captures/BA_Compartido_open.png',
    title: 'Detalle compartido',
    description: 'Desglosa por mes y subcategoría quién ha pagado qué en la cuenta conjunta.',
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
