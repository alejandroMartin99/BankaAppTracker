import { Injectable, signal, computed } from '@angular/core';

/** Mensajes que rotan mientras se espera la primera respuesta del backend (cold start). */
const LOADER_MESSAGES = [
  'Conectando con el servicio…',
  'Estamos cargando tus transacciones',
  'Es la primera carga, espera unos segundos',
  'Preparando tus datos…',
  'Un momento, por favor…',
];

@Injectable({ providedIn: 'root' })
export class BackendLoaderService {
  /** Si hay al menos una petición al backend en curso y aún no hemos recibido ninguna respuesta. */
  private readonly pending = signal(0);
  private readonly receivedAny = signal(false);

  readonly isVisible = computed(() => this.pending() > 0 && !this.receivedAny());

  /** Índice del mensaje a mostrar (rota cada 4 s). */
  readonly messageIndex = signal(0);

  private messageInterval: ReturnType<typeof setInterval> | null = null;

  requestStarted(): void {
    const prev = this.pending();
    this.pending.update((n) => n + 1);
    if (prev === 0) {
      this.messageIndex.set(0);
      this.messageInterval = setInterval(() => {
        this.messageIndex.update((i) => (i + 1) % LOADER_MESSAGES.length);
      }, 4000);
    }
  }

  responseReceived(): void {
    this.receivedAny.set(true);
    this.pending.update((n) => Math.max(0, n - 1));
    if (this.messageInterval) {
      clearInterval(this.messageInterval);
      this.messageInterval = null;
    }
  }

  getMessage(index: number): string {
    return LOADER_MESSAGES[index % LOADER_MESSAGES.length] ?? LOADER_MESSAGES[0];
  }
}
