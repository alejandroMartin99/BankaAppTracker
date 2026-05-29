import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
  NgZone,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { PrivacyService } from '../../services/privacy.service';
import { Transaction } from '../../models/transaction.model';

// ─── IRPF Data ───────────────────────────────────────────────────────────────

interface TaxBracket {
  upTo: number;
  rate: number;
}

/**
 * Tipos marginales consolidados (estatal + autonómico) 2024/2025.
 * Fuente: AEAT + boletines autonómicos.
 */
const CCAA_BRACKETS: Record<string, TaxBracket[]> = {
  AND: [ // Andalucía
    { upTo: 12_450, rate: 0.19 }, { upTo: 20_200, rate: 0.24 },
    { upTo: 35_200, rate: 0.30 }, { upTo: 60_000, rate: 0.37 },
    { upTo: 300_000, rate: 0.45 }, { upTo: Infinity, rate: 0.47 },
  ],
  ARA: [ // Aragón
    { upTo: 12_450, rate: 0.19 }, { upTo: 20_200, rate: 0.24 },
    { upTo: 35_200, rate: 0.30 }, { upTo: 60_000, rate: 0.37 },
    { upTo: 300_000, rate: 0.45 }, { upTo: Infinity, rate: 0.47 },
  ],
  AST: [ // Asturias
    { upTo: 12_450, rate: 0.19 }, { upTo: 20_200, rate: 0.25 },
    { upTo: 35_200, rate: 0.32 }, { upTo: 60_000, rate: 0.39 },
    { upTo: 300_000, rate: 0.46 }, { upTo: Infinity, rate: 0.49 },
  ],
  BAL: [ // Baleares
    { upTo: 12_450, rate: 0.19 }, { upTo: 20_200, rate: 0.24 },
    { upTo: 35_200, rate: 0.31 }, { upTo: 60_000, rate: 0.38 },
    { upTo: 300_000, rate: 0.46 }, { upTo: Infinity, rate: 0.48 },
  ],
  CAN: [ // Canarias
    { upTo: 12_450, rate: 0.19 }, { upTo: 20_200, rate: 0.24 },
    { upTo: 35_200, rate: 0.30 }, { upTo: 60_000, rate: 0.37 },
    { upTo: 300_000, rate: 0.45 }, { upTo: Infinity, rate: 0.47 },
  ],
  CAT: [ // Cataluña
    { upTo: 12_450, rate: 0.21 }, { upTo: 17_707, rate: 0.25 },
    { upTo: 21_000, rate: 0.31 }, { upTo: 33_007, rate: 0.39 },
    { upTo: 53_407, rate: 0.46 }, { upTo: 90_000, rate: 0.49 },
    { upTo: 120_000, rate: 0.50 }, { upTo: 175_000, rate: 0.505 },
    { upTo: Infinity, rate: 0.535 },
  ],
  CLM: [ // Castilla-La Mancha
    { upTo: 12_450, rate: 0.19 }, { upTo: 20_200, rate: 0.24 },
    { upTo: 35_200, rate: 0.30 }, { upTo: 60_000, rate: 0.37 },
    { upTo: 300_000, rate: 0.45 }, { upTo: Infinity, rate: 0.47 },
  ],
  CYL: [ // Castilla y León
    { upTo: 12_450, rate: 0.19 }, { upTo: 20_200, rate: 0.24 },
    { upTo: 35_200, rate: 0.30 }, { upTo: 60_000, rate: 0.37 },
    { upTo: 300_000, rate: 0.45 }, { upTo: Infinity, rate: 0.47 },
  ],
  EXT: [ // Extremadura
    { upTo: 12_450, rate: 0.19 }, { upTo: 20_200, rate: 0.25 },
    { upTo: 35_200, rate: 0.31 }, { upTo: 60_000, rate: 0.38 },
    { upTo: 300_000, rate: 0.46 }, { upTo: Infinity, rate: 0.49 },
  ],
  GAL: [ // Galicia
    { upTo: 12_450, rate: 0.19 }, { upTo: 20_200, rate: 0.24 },
    { upTo: 35_200, rate: 0.30 }, { upTo: 60_000, rate: 0.37 },
    { upTo: 300_000, rate: 0.45 }, { upTo: Infinity, rate: 0.47 },
  ],
  MAD: [ // Madrid (tipos más bajos de España)
    { upTo: 12_450, rate: 0.185 }, { upTo: 17_707, rate: 0.24 },
    { upTo: 33_007, rate: 0.29 }, { upTo: 53_407, rate: 0.37 },
    { upTo: 300_000, rate: 0.45 }, { upTo: Infinity, rate: 0.47 },
  ],
  MUR: [ // Murcia
    { upTo: 12_450, rate: 0.19 }, { upTo: 20_200, rate: 0.24 },
    { upTo: 35_200, rate: 0.30 }, { upTo: 60_000, rate: 0.37 },
    { upTo: 300_000, rate: 0.45 }, { upTo: Infinity, rate: 0.47 },
  ],
  NAV: [ // Navarra (régimen foral)
    { upTo: 7_000, rate: 0.13 }, { upTo: 15_000, rate: 0.24 },
    { upTo: 30_000, rate: 0.30 }, { upTo: 60_000, rate: 0.37 },
    { upTo: 100_000, rate: 0.43 }, { upTo: Infinity, rate: 0.47 },
  ],
  PV: [ // País Vasco (régimen foral — Álava/Bizkaia/Gipuzkoa, aproximado)
    { upTo: 12_500, rate: 0.20 }, { upTo: 20_000, rate: 0.25 },
    { upTo: 30_000, rate: 0.28 }, { upTo: 50_000, rate: 0.35 },
    { upTo: 80_000, rate: 0.40 }, { upTo: 150_000, rate: 0.45 },
    { upTo: Infinity, rate: 0.49 },
  ],
  RIO: [ // La Rioja
    { upTo: 12_450, rate: 0.19 }, { upTo: 20_200, rate: 0.24 },
    { upTo: 35_200, rate: 0.30 }, { upTo: 60_000, rate: 0.37 },
    { upTo: 300_000, rate: 0.45 }, { upTo: Infinity, rate: 0.47 },
  ],
  VAL: [ // Comunitat Valenciana
    { upTo: 12_450, rate: 0.205 }, { upTo: 20_200, rate: 0.245 },
    { upTo: 35_200, rate: 0.315 }, { upTo: 60_000, rate: 0.38 },
    { upTo: 120_000, rate: 0.46 }, { upTo: 175_000, rate: 0.50 },
    { upTo: 300_000, rate: 0.50 }, { upTo: Infinity, rate: 0.54 },
  ],
};

export const CCAA_LABELS: { code: string; name: string }[] = [
  { code: 'AND', name: 'Andalucía' },
  { code: 'ARA', name: 'Aragón' },
  { code: 'AST', name: 'Asturias' },
  { code: 'BAL', name: 'Baleares' },
  { code: 'CAN', name: 'Canarias' },
  { code: 'CAT', name: 'Cataluña' },
  { code: 'CLM', name: 'Castilla-La Mancha' },
  { code: 'CYL', name: 'Castilla y León' },
  { code: 'EXT', name: 'Extremadura' },
  { code: 'GAL', name: 'Galicia' },
  { code: 'MAD', name: 'Madrid' },
  { code: 'MUR', name: 'Murcia' },
  { code: 'NAV', name: 'Navarra (foral)' },
  { code: 'PV', name: 'País Vasco (foral)' },
  { code: 'RIO', name: 'La Rioja' },
  { code: 'VAL', name: 'C. Valenciana' },
];

// SS contribution limits 2025
const SS_MAX_BASE = 4_720.5; // €/mes
const SS_MIN_BASE_GENERAL = 1_323.0; // €/mes (grupo 1)

const SS_RATES = {
  contingencias: 0.0470,
  desempleo_indefinido: 0.0155,
  desempleo_parcial: 0.0160,
  formacion: 0.0010,
};

// Mínimos personales y familiares 2025
const MINIMO_PERSONAL = 5_550;
const MINIMO_MAYOR_65 = 6_700;
const MINIMO_MAYOR_75 = 8_100;

const MINIMO_DESCENDIENTES = [2_400, 2_700, 4_000, 4_500]; // 1º, 2º, 3º, 4º+ hijo
const MINIMO_DESCENDIENTE_3 = 2_800; // hijos < 3 años (adicional)

const REDUCCION_RENDIMIENTOS_TRABAJO_MAX = 5_565; // netos <= 13.115 €
const REDUCCION_RENDIMIENTOS_TRABAJO_MIN = 0;

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface SalarioConfig {
  brutoPeriod: 'anual' | 'mensual';
  bruto: number;
  pagas: 12 | 14 | 15 | 16;
  tipoContrato: 'indefinido' | 'parcial';
  situacion: 'soltero' | 'casado_sin_rentas' | 'casado_con_rentas';
  hijos: number;
  edadMayorHijo: number; // 0=no aplica, para extra <3 años
  edad: number;
  ccaa: string;
  segundoPagador: boolean;
  segundoPagadorImporte: number;
  retencionManual: boolean;
  retencionManualPct: number;
}

export interface SalarioResult {
  brutoAnual: number;
  brutoMensual: number;
  brutoPorPaga: number;
  ssAnual: number;
  ssMensual: number;
  baseCotizacion: number; // mensual
  baseLiquidable: number; // anual
  irpfAnual: number;
  irpfMensual: number;
  irpfEfectivo: number; // % sobre bruto
  irpfMarginal: number; // tramo máximo alcanzado
  netoAnual: number;
  netoMensual: number;
  netoPorPaga: number;
  reduccionRendimientos: number;
  minPersonalFamiliar: number;
}

export interface NominaReal {
  fecha: string;
  descripcion: string;
  subcategoria: string;
  importe: number;
  cuenta: string;
}

export interface DiagnosticoRetencion {
  netoRealMedio: number;
  brutoEstimadoMedio: number;
  retencionRealPct: number;
  retencionTeoricaPct: number;
  diferenciaPct: number;
  estado: 'ok' | 'alta' | 'baja';
  mensaje: string;
  riesgo: 'ninguno' | 'devolucion' | 'pago';
}

const STORAGE_KEY = 'banka.salario.config';

// ─── Component ───────────────────────────────────────────────────────────────

@Component({
  selector: 'app-salario',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './salario.component.html',
  styleUrl: './salario.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SalarioComponent implements OnInit {
  readonly ccaaLabels = CCAA_LABELS;

  config: SalarioConfig = {
    brutoPeriod: 'anual',
    bruto: 30_000,
    pagas: 14,
    tipoContrato: 'indefinido',
    situacion: 'soltero',
    hijos: 0,
    edadMayorHijo: 0,
    edad: 35,
    ccaa: 'MAD',
    segundoPagador: false,
    segundoPagadorImporte: 0,
    retencionManual: false,
    retencionManualPct: 15,
  };

  result: SalarioResult | null = null;

  // Nóminas reales
  nominasLoading = false;
  nominasError = '';
  nominasReales: NominaReal[] = [];
  nominaSubcategorias: string[] = [];
  selectedSubcategoria = '';
  diagnostico: DiagnosticoRetencion | null = null;
  showAllNominas = false;

  // UI helpers
  inputsExpanded = true;

  constructor(
    private txService: TransactionService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    public privacy: PrivacyService,
  ) {}

  ngOnInit(): void {
    this.loadConfig();
    this.calculate();
    this.loadNominas();
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private loadConfig(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SalarioConfig>;
        this.config = { ...this.config, ...saved };
      }
    } catch {
      // ignore
    }
  }

  private saveConfig(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch {
      // ignore
    }
  }

  // ── Input handlers ─────────────────────────────────────────────────────────

  onConfigChange(): void {
    this.saveConfig();
    this.calculate();
    this.updateDiagnostico();
    this.cdr.detectChanges();
  }

  setPagas(p: number): void {
    this.config.pagas = p as 12 | 14 | 15 | 16;
    this.onConfigChange();
  }

  get brutoAnual(): number {
    return this.config.brutoPeriod === 'anual'
      ? this.config.bruto
      : this.config.bruto * 12;
  }

  togglePeriod(): void {
    if (this.config.brutoPeriod === 'anual') {
      this.config.bruto = +(this.config.bruto / 12).toFixed(2);
      this.config.brutoPeriod = 'mensual';
    } else {
      this.config.bruto = +(this.config.bruto * 12).toFixed(2);
      this.config.brutoPeriod = 'anual';
    }
    this.onConfigChange();
  }

  // ── SS calculation ─────────────────────────────────────────────────────────

  private calcSS(brutoAnual: number): { anual: number; mensual: number; baseCotizacion: number } {
    const brutoMensual = brutoAnual / 12;
    const base = Math.min(Math.max(brutoMensual, SS_MIN_BASE_GENERAL), SS_MAX_BASE);
    const rDesempleo =
      this.config.tipoContrato === 'parcial'
        ? SS_RATES.desempleo_parcial
        : SS_RATES.desempleo_indefinido;
    const rTotal = SS_RATES.contingencias + rDesempleo + SS_RATES.formacion;
    const ssMensual = +(base * rTotal).toFixed(2);
    return { anual: +(ssMensual * 12).toFixed(2), mensual: ssMensual, baseCotizacion: base };
  }

  // ── Mínimos personales y familiares ────────────────────────────────────────

  private calcMinimoPersonalFamiliar(): number {
    let min = this.config.edad >= 75 ? MINIMO_MAYOR_75 : this.config.edad >= 65 ? MINIMO_MAYOR_65 : MINIMO_PERSONAL;

    // Cónyuge sin rentas: reducción en cuota, no en mínimo del propio contribuyente
    // (Se gestiona via reducción, no mínimo; simplificamos sumando 3.400 como deducción equivalente)
    if (this.config.situacion === 'casado_sin_rentas') {
      min += 3_400;
    }

    // Descendientes
    const hijos = Math.max(0, Math.min(this.config.hijos, 8));
    for (let i = 0; i < hijos; i++) {
      min += MINIMO_DESCENDIENTES[Math.min(i, 3)]!;
    }
    // Hijos < 3 años (asumimos el primero si edadMayorHijo = 0)
    if (this.config.edadMayorHijo < 3 && hijos > 0) {
      min += MINIMO_DESCENDIENTE_3;
    }

    return min;
  }

  // ── Reducción por rendimientos del trabajo ─────────────────────────────────

  private calcReduccionRendimientos(netoTrabajo: number): number {
    if (netoTrabajo <= 13_115) {
      return REDUCCION_RENDIMIENTOS_TRABAJO_MAX;
    } else if (netoTrabajo <= 16_825) {
      return Math.max(0, REDUCCION_RENDIMIENTOS_TRABAJO_MAX - 1.5 * (netoTrabajo - 13_115));
    }
    return REDUCCION_RENDIMIENTOS_TRABAJO_MIN;
  }

  // ── IRPF bracket engine ────────────────────────────────────────────────────

  private calcIRPF(baseLiquidable: number, ccaa: string): { total: number; marginal: number } {
    if (baseLiquidable <= 0) return { total: 0, marginal: 0 };
    const brackets = CCAA_BRACKETS[ccaa] ?? CCAA_BRACKETS['MAD']!;
    let tax = 0;
    let prev = 0;
    let marginal = brackets[0]!.rate;
    for (const b of brackets) {
      if (baseLiquidable <= prev) break;
      const tramo = Math.min(baseLiquidable, b.upTo) - prev;
      tax += tramo * b.rate;
      marginal = b.rate;
      prev = b.upTo;
    }
    return { total: +tax.toFixed(2), marginal };
  }

  // ── Main calculation ───────────────────────────────────────────────────────

  calculate(): void {
    const brutoAnual = this.brutoAnual;
    const { anual: ssAnual, mensual: ssMensual, baseCotizacion } = this.calcSS(brutoAnual);

    // Neto trabajo previo a reducciones (para calcular reducción rendimientos)
    const netoTrabajo = brutoAnual - ssAnual;
    const reduccionRendimientos = this.calcReduccionRendimientos(netoTrabajo);
    const minPersonalFamiliar = this.calcMinimoPersonalFamiliar();

    // Base imponible general
    let baseImponible = netoTrabajo - reduccionRendimientos;
    baseImponible = Math.max(0, baseImponible);

    // Base liquidable = base imponible - mínimo personal y familiar
    let baseLiquidable = Math.max(0, baseImponible - minPersonalFamiliar);

    // Con segundo pagador: sumamos sus rentas a efectos de calcular el tipo aplicable
    // (el tipo se aplica solo sobre la base del primer pagador pero se determina con total)
    let baseLiquidableTotal = baseLiquidable;
    if (this.config.segundoPagador && this.config.segundoPagadorImporte > 0) {
      const ssExtra = this.calcSS(this.config.segundoPagadorImporte).anual;
      const netoExtra = this.config.segundoPagadorImporte - ssExtra;
      baseLiquidableTotal = Math.max(0, baseLiquidable + netoExtra);
    }

    const { total: irpfAnual, marginal: irpfMarginal } = this.config.retencionManual
      ? {
          total: +(brutoAnual * (this.config.retencionManualPct / 100)).toFixed(2),
          marginal: this.config.retencionManualPct / 100,
        }
      : this.calcIRPF(baseLiquidableTotal, this.config.ccaa);

    const irpfMensual = +(irpfAnual / 12).toFixed(2);
    const irpfEfectivo = brutoAnual > 0 ? +((irpfAnual / brutoAnual) * 100).toFixed(2) : 0;

    const netoAnual = +(brutoAnual - ssAnual - irpfAnual).toFixed(2);
    const netoMensual = +(netoAnual / 12).toFixed(2);
    const netoPorPaga = +(netoAnual / this.config.pagas).toFixed(2);

    this.result = {
      brutoAnual,
      brutoMensual: +(brutoAnual / 12).toFixed(2),
      brutoPorPaga: +(brutoAnual / this.config.pagas).toFixed(2),
      ssAnual,
      ssMensual,
      baseCotizacion,
      baseLiquidable: baseLiquidableTotal,
      irpfAnual,
      irpfMensual,
      irpfEfectivo,
      irpfMarginal: +(irpfMarginal * 100).toFixed(1),
      netoAnual,
      netoMensual,
      netoPorPaga,
      reduccionRendimientos,
      minPersonalFamiliar,
    };
  }

  // ── Bar proportions ────────────────────────────────────────────────────────

  get ssPct(): number {
    if (!this.result || this.result.brutoAnual === 0) return 0;
    return +((this.result.ssAnual / this.result.brutoAnual) * 100).toFixed(1);
  }

  get irpfPct(): number {
    return this.result?.irpfEfectivo ?? 0;
  }

  get netoPct(): number {
    if (!this.result || this.result.brutoAnual === 0) return 0;
    return +((this.result.netoAnual / this.result.brutoAnual) * 100).toFixed(1);
  }

  // ── Nóminas reales ─────────────────────────────────────────────────────────

  private loadNominas(): void {
    this.nominasLoading = true;
    this.txService.getTransactions().subscribe({
      next: (res) => {
        this.ngZone.run(() => {
          const txs: Transaction[] = (Array.isArray(res?.data) ? res.data : []) as Transaction[];
          this.nominasReales = txs
            .filter((t) => {
              const cat = (t.categoria || '').toString().trim().toLowerCase();
              return cat === 'nómina' || cat === 'nomina';
            })
            .filter((t) => (t.importe ?? 0) > 0)
            .sort((a, b) => (b.dt_date ?? '').localeCompare(a.dt_date ?? ''))
            .slice(0, 24)
            .map((t) => ({
              fecha: (t.dt_date ?? '').toString().slice(0, 10),
              descripcion: (t.descripcion ?? (t as { concepto?: string }).concepto ?? '').toString(),
              subcategoria: (t.subcategoria ?? '').toString().trim(),
              importe: t.importe ?? 0,
              cuenta: (t.cuenta ?? '').toString(),
            }));

          // Extraer subcategorías únicas disponibles
          const seen = new Set<string>();
          this.nominaSubcategorias = [];
          for (const n of this.nominasReales) {
            if (n.subcategoria && !seen.has(n.subcategoria)) {
              seen.add(n.subcategoria);
              this.nominaSubcategorias.push(n.subcategoria);
            }
          }
          // Seleccionar primera por defecto si no hay ninguna elegida
          if (!this.selectedSubcategoria && this.nominaSubcategorias.length > 0) {
            this.selectedSubcategoria = this.nominaSubcategorias[0]!;
          }

          this.nominasLoading = false;
          this.updateDiagnostico();
          this.cdr.detectChanges();
        });
      },
      error: () => {
        this.ngZone.run(() => {
          this.nominasLoading = false;
          this.nominasError = 'No se pudieron cargar las nóminas.';
          this.cdr.detectChanges();
        });
      },
    });
  }

  onSubcategoriaChange(): void {
    this.updateDiagnostico();
    this.cdr.detectChanges();
  }

  get nominasFiltradas(): NominaReal[] {
    if (!this.selectedSubcategoria) return this.nominasReales;
    return this.nominasReales.filter((n) => n.subcategoria === this.selectedSubcategoria);
  }

  // ── Diagnóstico retención ─────────────────────────────────────────────────

  private updateDiagnostico(): void {
    const filtered = this.nominasFiltradas;
    if (!this.result || filtered.length === 0) {
      this.diagnostico = null;
      return;
    }
    // Usar solo la última nómina; comparar contra bruto y neto POR PAGA (no mensual)
    const ultima = filtered[0]!;
    const netoRealMedio = ultima.importe;
    const brutoEstimadoMedio = this.result.brutoPorPaga;
    const retencionTeoricaPct = this.result.irpfEfectivo + this.ssPct;
    const retencionRealPct =
      brutoEstimadoMedio > 0
        ? +((1 - netoRealMedio / brutoEstimadoMedio) * 100).toFixed(2)
        : 0;
    const diferenciaPct = +(retencionRealPct - retencionTeoricaPct).toFixed(2);

    let estado: DiagnosticoRetencion['estado'] = 'ok';
    let mensaje = '';
    let riesgo: DiagnosticoRetencion['riesgo'] = 'ninguno';

    if (diferenciaPct > 2) {
      estado = 'alta';
      mensaje =
        `Tu retención actual (${retencionRealPct.toFixed(1)} %) es mayor a la teórica ` +
        `(${retencionTeoricaPct.toFixed(1)} %). Estás pagando de más cada mes — probable ` +
        `devolución en la declaración. Puedes solicitar a RRHH reducir el porcentaje de retención.`;
      riesgo = 'devolucion';
    } else if (diferenciaPct < -2) {
      estado = 'baja';
      mensaje =
        `Tu retención actual (${retencionRealPct.toFixed(1)} %) es menor a la teórica ` +
        `(${retencionTeoricaPct.toFixed(1)} %). Puedes acabar pagando a Hacienda en la declaración. ` +
        `Considera pedir a RRHH que suban el porcentaje de retención.`;
      riesgo = 'pago';
    } else {
      mensaje =
        `Tu retención está alineada con lo teórico (${retencionTeoricaPct.toFixed(1)} %). Vas bien.`;
    }

    this.diagnostico = {
      netoRealMedio,
      brutoEstimadoMedio,
      retencionRealPct,
      retencionTeoricaPct,
      diferenciaPct,
      estado,
      mensaje,
      riesgo,
    };
  }

  // ── UI helpers ─────────────────────────────────────────────────────────────

  get segundoPagadorWarning(): boolean {
    return (
      this.config.segundoPagador &&
      this.config.segundoPagadorImporte > 1_500
    );
  }

  getCcaaName(code: string): string {
    return CCAA_LABELS.find((c) => c.code === code)?.name ?? code;
  }

  // Tabla desglose SS
  get ssDesglose(): { label: string; pct: number; importe: number }[] {
    if (!this.result) return [];
    const base = this.result.baseCotizacion;
    const rDes =
      this.config.tipoContrato === 'parcial'
        ? SS_RATES.desempleo_parcial
        : SS_RATES.desempleo_indefinido;
    return [
      { label: 'Contingencias comunes', pct: SS_RATES.contingencias * 100, importe: +(base * SS_RATES.contingencias).toFixed(2) },
      { label: 'Desempleo', pct: rDes * 100, importe: +(base * rDes).toFixed(2) },
      { label: 'Formación profesional', pct: SS_RATES.formacion * 100, importe: +(base * SS_RATES.formacion).toFixed(2) },
    ];
  }
}
