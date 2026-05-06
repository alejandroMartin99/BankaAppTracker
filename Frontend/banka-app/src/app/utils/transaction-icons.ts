/**
 * Todos los iconos son locales en /icons/ (sin peticiones).
 * Ejecutar una vez: node scripts/download-all-icons.js
 */

const ICONS_BASE = '/icons';

/** Subcategoría -> key (archivo key.png) */
const BRAND_KEYS: Record<string, string> = {
  Mercadona: 'mercadona',
  Carrefour: 'carrefour',
  Lidl: 'lidl',
  IKEA: 'ikea',
  Amazon: 'amazon',
  UBER: 'uber',
  JYSK: 'jysk',
  Douglas: 'douglas',
  Primor: 'primor',
  Notino: 'notino',
  UNIQLO: 'uniqlo',
  'LEROY MERLIN': 'leroy-merlin',
  Cursor: 'cursor',
  'Burger King': 'burger-king',
  Kinepolis: 'kinepolis',
  EASYPARK: 'easypark',
  Amovens_Alquiler_Furgo: 'amovens',
  Revolut: 'revolut',
  Kraken: 'kraken',
  'Siemens CAFE': 'siemens',
  Ahorramas: 'ahorramas',
  Apple: 'apple',
  Druni: 'druni',
  LEFTIES: 'lefties',
  OYSHO: 'oysho',
  Alcampo: 'alcampo',
  'PULL&BEAR': 'pull-and-bear',
  PULLANDBEAR: 'pull-and-bear',
  BERSHKA: 'bershka',
  'Centro Maderero Valdebernardo': 'cmb-bricolage',
  CMB: 'cmb-bricolage',
  MANGO: 'mango',
  STRADIVARIUS: 'stradivarius',
  ZARA: 'zara',
  Metro: 'metro-madrid',
  'ALVARO MORENO': 'alvaro-moreno',
  MILFSHAKES: 'milfshakes',
  Singularu: 'singularu',
  'EL CORTE INGLES': 'el-corte-ingles',
  Booking: 'booking',
  ASOS: 'asos',
  Aldi: 'aldi',
  Obramat: 'obramat',
  INECO: 'ineco',
  INDRA: 'indra',
  'DELIKIA CAFE': 'delikia-cafe',
};

/** Subcategoría -> icono local (archivo prefix-icon.svg) */
const SUBCATEGORIA_ICONS: Record<string, { icon: string; color?: string }> = {
  Gasolina: { icon: 'mdi:gas-station', color: '#f44336' },
  Peaje: { icon: 'mdi:highway', color: '#ff9800' },
  PARKING: { icon: 'mdi:parking', color: '#2196f3' },
  'Transporte Público': { icon: 'mdi:bus', color: '#2196f3' },
  Hogardexter: { icon: 'mdi:home-thermometer', color: '#ff6b00' },
  Crypto_Revolut: { icon: 'mdi:currency-btc', color: '#f7931a' },
  'DELIKIA CAFE': { icon: 'mdi:coffee', color: '#6d4c41' },
  'Pizzeria Di Carlo': { icon: 'mdi:food', color: '#e74c3c' },
  'INDRA_Meson_Oro_Y_Plata': { icon: 'mdi:silverware-fork-knife', color: '#ffc107' },
  Marimer: { icon: 'mdi:cake', color: '#e91e63' },
  'TOY&TASTE': { icon: 'mdi:food-variant', color: '#4caf50' },
  'PILAR AKANEYA': { icon: 'mdi:rice', color: '#795548' },
  'DeEventoss': { icon: 'mdi:party-popper', color: '#9c27b0' },
  Gimnasio: { icon: 'mdi:dumbbell', color: '#ff5722' },
  Peluquero: { icon: 'mdi:content-cut', color: '#795548' },
  Vivienda: { icon: 'mdi:home', color: '#2196f3' },
  Hipoteca: { icon: 'mdi:bank', color: '#1976d2' },
  Intereses: { icon: 'mdi:percent', color: '#4caf50' },
  Seguros: { icon: 'mdi:shield-check', color: '#2196f3' },
  Vida: { icon: 'mdi:heart-pulse', color: '#e91e63' },
  Gas: { icon: 'mdi:fire', color: '#ff9800' },
  Agua: { icon: 'mdi:water', color: '#03a9f4' },
  Comunidad: { icon: 'mdi:office-building', color: '#607d8b' },
  Recarga: { icon: 'mdi:credit-card-refund', color: '#4caf50' },
  CAJERO: { icon: 'mdi:bank-outline', color: '#607d8b' },
  Singularu: { icon: 'mdi:tshirt-crew-outline', color: '#000000' },
  'ALVARO MORENO': { icon: 'mdi:tshirt-crew-outline', color: '#000000' },
  'JACK & JONES': { icon: 'mdi:tshirt-crew', color: '#000000' },
  'Flores_Lucia': { icon: 'mdi:flower', color: '#e91e63' },
  'La Labranza': { icon: 'mdi:silverware-fork-knife', color: '#8d6e63' },
  'Cena EMPRESA GARELOS': { icon: 'mdi:food', color: '#ff9800' },
  'Provision_Fondos': { icon: 'mdi:bank-transfer', color: '#1976d2' },
  'Aportacion_Conjunta_Alex': { icon: 'mdi:account-arrow-right', color: '#2196f3' },
  'Aportacion_Conjunta_Lucia': { icon: 'mdi:account-arrow-right', color: '#9c27b0' },
  'Inicio_Conjunta_Revolut': { icon: 'mdi:bank-transfer-in', color: '#4caf50' },
};

const CATEGORIA_ICONS: Record<string, { icon: string; color?: string }> = {
  Supermercado: { icon: 'mdi:cart', color: '#4caf50' },
  Restaurantes: { icon: 'mdi:silverware-fork-knife', color: '#ff9800' },
  Transporte: { icon: 'mdi:car', color: '#2196f3' },
  Hogar: { icon: 'mdi:home', color: '#795548' },
  BienEstar: { icon: 'mdi:spa', color: '#9c27b0' },
  Suministros: { icon: 'mdi:lightning-bolt', color: '#ffc107' },
  bizum: { icon: 'mdi:cellphone', color: '#00a0e3' },
  Transferencia: { icon: 'mdi:swap-horizontal', color: '#607d8b' },
  INVERSIONES: { icon: 'mdi:chart-line', color: '#4caf50' },
  nomina: { icon: 'mdi:briefcase', color: '#2196f3' },
  Banco: { icon: 'mdi:bank', color: '#1976d2' },
  banco: { icon: 'mdi:bank', color: '#1976d2' },
  Ropa: { icon: 'mdi:tshirt-crew', color: '#000000' },
  OCIO: { icon: 'mdi:movie-open', color: '#e91e63' },
};

const DEFAULT_ICON = { icon: 'mdi:credit-card', color: '#9e9e9e' };

/** Descripción menciona marca -> key logo local */
const DESC_BRANDS: Record<string, string> = {
  AMAZON: 'amazon',
  MERCADONA: 'mercadona',
  CARREFOUR: 'carrefour',
  LIDL: 'lidl',
  IKEA: 'ikea',
  UBER: 'uber',
  REVOLUT: 'revolut',
  AHORRAMAS: 'ahorramas',
  APPLE: 'apple',
  DRUNI: 'druni',
  LEFTIES: 'lefties',
  OYSHO: 'oysho',
  ALCAMPO: 'alcampo',
  'PULL&BEAR': 'pull-and-bear',
  PULLANDBEAR: 'pull-and-bear',
  'PULL AND BEAR': 'pull-and-bear',
  BERSHKA: 'bershka',
  CMB: 'cmb-bricolage',
  'CENTRO MADERERO': 'cmb-bricolage',
  MANGO: 'mango',
  STRADIVARIUS: 'stradivarius',
  ZARA: 'zara',
  METRO: 'metro-madrid',
  METROMADRID: 'metro-madrid',
  'METRO MADRID': 'metro-madrid',
  DOUGLAS: 'douglas',
  PRIMOR: 'primor',
  NOTINO: 'notino',
  JYSK: 'jysk',
  UNIQLO: 'uniqlo',
  'LEROY MERLIN': 'leroy-merlin',
  LEROYMERLIN: 'leroy-merlin',
  CURSOR: 'cursor',
  'BURGER KING': 'burger-king',
  BURGERKING: 'burger-king',
  KINEPOLIS: 'kinepolis',
  EASYPARK: 'easypark',
  AMOVENS: 'amovens',
  KRAKEN: 'kraken',
  SIEMENS: 'siemens',
  'ALVARO MORENO': 'alvaro-moreno',
  MILFSHAKES: 'milfshakes',
  SINGULARU: 'singularu',
  'EL CORTE INGLES': 'el-corte-ingles',
  ELCORTEINGLES: 'el-corte-ingles',
  BOOKING: 'booking',
  ASOS: 'asos',
  ALDI: 'aldi',
  OBRAMAT: 'obramat',
  INECO: 'ineco',
  'OBRAMAT.ES': 'obramat',
  INDRA: 'indra',
  DELIKIA: 'delikia-cafe',
  'DELIKIA CAFE': 'delikia-cafe',
};

export interface IconInfo {
  url: string;
  color?: string;
  isLogo?: boolean;
}

/** Icono Iconify: prefix-icon.svg */
function localIcon(prefix: string, icon: string): string {
  return `${ICONS_BASE}/${prefix}-${icon}.svg`;
}

/** Logo marca: key.png */
function logoUrl(key: string): string {
  return `${ICONS_BASE}/${key}.png`;
}

/** Devuelve icono/logo local (sin peticiones externas) */
export function getTransactionIconInfo(
  t: { categoria?: string; subcategoria?: string; descripcion?: string }
): IconInfo {
  const sub = (t.subcategoria || '').trim();
  const subUpper = sub.toUpperCase();
  const cat = (t.categoria || '').trim();
  const desc = (t.descripcion || '').toUpperCase();

  // 1. Logo por subcategoría
  const subBrandKey = BRAND_KEYS[sub] || BRAND_KEYS[subUpper] || BRAND_KEYS[sub.toLowerCase()];
  if (subBrandKey) {
    return { url: logoUrl(subBrandKey), isLogo: true };
  }
  // 1b. Match parcial por subcategoría (ej: "INECO_nomina", "Pago INECO")
  for (const [brandToken, key] of Object.entries(BRAND_KEYS)) {
    if (subUpper.includes(brandToken.toUpperCase())) {
      return { url: logoUrl(key), isLogo: true };
    }
  }

  // 2. Logo por descripción (ej: "Amazon", "Mercadona")
  for (const [key, logoKey] of Object.entries(DESC_BRANDS)) {
    if (desc.includes(key)) {
      return { url: logoUrl(logoKey), isLogo: true };
    }
  }

  // 3. Bizum
  if (desc.includes('BIZUM') || cat.toLowerCase() === 'bizum') {
    return { url: localIcon('mdi', 'cellphone'), color: '#00a0e3' };
  }

  // 4. Icono por subcategoría
  const subInfo = sub && SUBCATEGORIA_ICONS[sub];
  if (subInfo) {
    const [prefix, icon] = subInfo.icon.split(':');
    return { url: localIcon(prefix, icon), color: subInfo.color };
  }

  // 5. Icono por categoría
  const catInfo = cat && CATEGORIA_ICONS[cat];
  if (catInfo) {
    const [prefix, icon] = catInfo.icon.split(':');
    return { url: localIcon(prefix, icon), color: catInfo.color };
  }

  // 6. Default (placeholder local)
  const [prefix, icon] = DEFAULT_ICON.icon.split(':');
  return {
    url: localIcon(prefix, icon),
    color: DEFAULT_ICON.color
  };
}
