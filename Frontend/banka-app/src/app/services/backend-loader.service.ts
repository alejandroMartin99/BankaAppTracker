import { Injectable, signal, computed } from '@angular/core';

export interface LoaderMessage {
  text: string;
  category: string;
}

const LOADER_DURATION_MS = 90_000;
const MESSAGE_ROTATE_MS = 6_000;
const FAST_COMPLETE_MS = 500;
const PROGRESS_TICK_MS = 100;
const MAX_PROGRESS_BEFORE_RESPONSE = 92;

const LOADER_MESSAGES: LoaderMessage[] = [
  { text: 'El mejor momento para ahorrar fue ayer. El segundo mejor, hoy.', category: 'Ahorro' },
  { text: 'Invertir es plantar árboles bajo cuyas sombras no esperas sentarte.', category: 'Inversión' },
  { text: 'Pequeños gastos repetidos son los que más pesan al final del mes.', category: 'Hábitos' },
  { text: 'No se trata de ganar más, sino de decidir mejor.', category: 'Mentalidad' },
  { text: 'La riqueza se construye lento y se destruye rápido.', category: 'Paciencia' },
  { text: 'Quien no controla sus gastos, no controla su futuro.', category: 'Ahorro' },
  { text: 'El interés compuesto es la octava maravilla del mundo.', category: 'Inversión' },
  { text: 'Un presupuesto no te limita: te da libertad para gastar sin culpa.', category: 'Hábitos' },
  { text: 'Gasta con intención. Ahorra con propósito.', category: 'Mentalidad' },
  { text: 'La paciencia en los mercados paga más que la prisa.', category: 'Inversión' },
  { text: 'Cada euro ahorrado hoy es un euro que trabaja por ti mañana.', category: 'Ahorro' },
  { text: 'Conocer tus números es el primer paso hacia la tranquilidad financiera.', category: 'Hábitos' },
  { text: 'Invertir sin plan es apostar. Planificar es construir.', category: 'Inversión' },
  { text: 'Los grandes logros financieros empiezan con decisiones pequeñas.', category: 'Mentalidad' },
  { text: 'El tiempo en el mercado vence al timing del mercado.', category: 'Paciencia' },
  { text: 'Ahorrar no es privarte: es elegir tu yo del futuro.', category: 'Ahorro' },
  { text: 'Revisa tus gastos hoy y dormirás más tranquilo mañana.', category: 'Hábitos' },
  { text: 'La diversificación es el único almuerzo gratis en finanzas.', category: 'Inversión' },
];

const WAITING_MESSAGE: LoaderMessage = {
  text: 'Casi listo, un momento más…',
  category: 'Conexión',
};

@Injectable({ providedIn: 'root' })
export class BackendLoaderService {
  /** Peticiones API en curso durante el cold start de sesión. */
  private readonly pending = signal(0);
  /** Cargas de pestaña que usan el mismo loader (Compartidos, Fondos…). */
  private readonly pageLoads = signal(0);
  private readonly sessionDone = signal(false);
  private readonly backendReady = signal(false);
  private readonly startedAt = signal<number | null>(null);

  readonly progress = signal(0);
  readonly isClosing = signal(false);
  readonly isStalled = signal(false);

  readonly isVisible = computed(
    () =>
      this.isClosing() ||
      this.pageLoads() > 0 ||
      (!this.sessionDone() && this.pending() > 0),
  );

  readonly messageIndex = signal(0);

  private messageInterval: ReturnType<typeof setInterval> | null = null;
  private progressInterval: ReturnType<typeof setInterval> | null = null;
  private completeTimeout: ReturnType<typeof setTimeout> | null = null;
  private shuffledIndices: number[] = [];

  requestStarted(): void {
    if (this.sessionDone()) return;

    const wasActive = this.isBusy();
    this.pending.update((n) => n + 1);
    if (!wasActive) this.startSession();
  }

  responseReceived(): void {
    this.pending.update((n) => Math.max(0, n - 1));
    this.tryFinish();
  }

  /** Primera carga de pestañas que no disparan el interceptor a tiempo. */
  beginPageLoad(): void {
    const wasActive = this.isBusy();
    this.pageLoads.update((n) => n + 1);
    if (!wasActive) this.startSession();
  }

  endPageLoad(): void {
    this.pageLoads.update((n) => Math.max(0, n - 1));
    this.tryFinish();
  }

  getMessage(index: number): LoaderMessage {
    if (this.isStalled()) return WAITING_MESSAGE;
    const msgIndex = this.shuffledIndices[index % this.shuffledIndices.length];
    return LOADER_MESSAGES[msgIndex] ?? LOADER_MESSAGES[0];
  }

  getCategory(index: number): string {
    return this.getMessage(index).category;
  }

  getQuoteText(index: number): string {
    return this.getMessage(index).text;
  }

  private isBusy(): boolean {
    return this.isClosing() || this.pageLoads() > 0 || (!this.sessionDone() && this.pending() > 0);
  }

  private startSession(): void {
    this.resetSession();
    this.startProgress();
    this.startMessageRotation();
  }

  private tryFinish(): void {
    if (this.backendReady() || this.isClosing()) return;
    if (this.pending() > 0 || this.pageLoads() > 0) return;

    this.backendReady.set(true);
    this.stopMessageRotation();
    this.stopProgress();
    this.completeAndDismiss();
  }

  private resetSession(): void {
    this.progress.set(0);
    this.isClosing.set(false);
    this.isStalled.set(false);
    this.backendReady.set(false);
    this.startedAt.set(Date.now());
    this.shuffledIndices = this.shuffleIndices(LOADER_MESSAGES.length);
    this.messageIndex.set(0);
  }

  private startProgress(): void {
    this.stopProgress();
    this.progressInterval = setInterval(() => this.tickProgress(), PROGRESS_TICK_MS);
  }

  private tickProgress(): void {
    if (this.isClosing() || this.backendReady()) return;

    const started = this.startedAt();
    if (started == null) return;

    const elapsed = Date.now() - started;
    const ratio = Math.min(1, elapsed / LOADER_DURATION_MS);
    const eased = 1 - Math.pow(1 - ratio, 2.5);
    const next = Math.min(MAX_PROGRESS_BEFORE_RESPONSE, eased * MAX_PROGRESS_BEFORE_RESPONSE);

    this.progress.set(Math.round(next));

    if (elapsed >= LOADER_DURATION_MS && !this.backendReady()) {
      this.isStalled.set(true);
    }
  }

  private completeAndDismiss(): void {
    this.isClosing.set(true);
    const start = this.progress();
    const startTime = performance.now();

    const animate = (now: number) => {
      const t = Math.min(1, (now - startTime) / FAST_COMPLETE_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      this.progress.set(Math.round(start + (100 - start) * eased));

      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        this.progress.set(100);
        this.completeTimeout = setTimeout(() => {
          this.sessionDone.set(true);
          this.isClosing.set(false);
          this.backendReady.set(false);
        }, 200);
      }
    };

    requestAnimationFrame(animate);
  }

  private startMessageRotation(): void {
    this.stopMessageRotation();
    this.messageInterval = setInterval(() => {
      if (this.isClosing()) return;
      this.messageIndex.update((i) => (i + 1) % this.shuffledIndices.length);
    }, MESSAGE_ROTATE_MS);
  }

  private stopMessageRotation(): void {
    if (this.messageInterval) {
      clearInterval(this.messageInterval);
      this.messageInterval = null;
    }
  }

  private stopProgress(): void {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  private shuffleIndices(length: number): number[] {
    const indices = Array.from({ length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices;
  }
}
