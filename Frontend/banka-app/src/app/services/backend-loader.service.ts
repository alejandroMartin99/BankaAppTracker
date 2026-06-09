import { Injectable, signal, computed } from '@angular/core';
import {
  LOADER_SHOWCASE_SLIDES,
  LoaderShowcaseSlide,
} from '../components/backend-loader/loader-showcase.data';

export type LoaderVariant = 'splash' | 'minimal';

const LOADER_DURATION_MS = 90_000;
const SLIDE_ROTATE_MS = 5_500;
const FAST_COMPLETE_MS = 500;
const PROGRESS_TICK_MS = 100;
const MAX_PROGRESS_BEFORE_RESPONSE = 92;

const WAITING_SLIDE: LoaderShowcaseSlide = {
  image: '/captures/BA_Gastos.png',
  title: 'Casi listo',
  description: 'Estamos conectando con el servicio. Un momento más…',
  tag: 'Conexión',
};

@Injectable({ providedIn: 'root' })
export class BackendLoaderService {
  private readonly splashActive = signal(false);
  private readonly splashDone = signal(false);
  private readonly minimalLoads = signal(0);
  private readonly backendReady = signal(false);
  private readonly startedAt = signal<number | null>(null);
  private closingVariant = signal<LoaderVariant | null>(null);

  readonly progress = signal(0);
  readonly isClosing = signal(false);
  readonly isStalled = signal(false);

  readonly variant = computed<LoaderVariant | null>(() => {
    if (this.isClosing()) return this.closingVariant();
    if (this.splashActive()) return 'splash';
    if (this.minimalLoads() > 0) return 'minimal';
    return null;
  });

  readonly isVisible = computed(
    () => this.isClosing() || this.splashActive() || this.minimalLoads() > 0,
  );

  readonly isSplash = computed(() => this.variant() === 'splash');
  readonly isMinimal = computed(() => this.variant() === 'minimal');

  readonly slideIndex = signal(0);
  readonly showcaseCount = LOADER_SHOWCASE_SLIDES.length;

  private slideInterval: ReturnType<typeof setInterval> | null = null;
  private progressInterval: ReturnType<typeof setInterval> | null = null;
  private completeTimeout: ReturnType<typeof setTimeout> | null = null;
  private shuffledIndices: number[] = [];

  /** Loader inicial (solo una vez por sesión, hasta la primera respuesta del backend). */
  beginSplashLoad(): void {
    if (this.splashDone() || this.splashActive()) return;
    this.splashActive.set(true);
    this.startSplashSession();
  }

  endSplashLoad(): void {
    if (!this.splashActive()) return;
    this.finish('splash', () => {
      this.splashActive.set(false);
      this.splashDone.set(true);
    });
  }

  /** Loader compacto para Compartidos, Inversión, Hipotecas. */
  beginMinimalLoad(): void {
    this.minimalLoads.update((n) => n + 1);
  }

  endMinimalLoad(): void {
    this.minimalLoads.update((n) => Math.max(0, n - 1));
    if (this.minimalLoads() > 0 || this.splashActive()) return;
    this.finish('minimal', () => undefined);
  }

  getShowcaseSlide(index: number): LoaderShowcaseSlide {
    if (this.isStalled()) return WAITING_SLIDE;
    const slideIndex = this.shuffledIndices[index % this.shuffledIndices.length];
    return LOADER_SHOWCASE_SLIDES[slideIndex] ?? LOADER_SHOWCASE_SLIDES[0];
  }

  private startSplashSession(): void {
    this.resetSession();
    this.startProgress();
    this.startSlideRotation();
  }

  private finish(kind: LoaderVariant, onDone: () => void): void {
    if (this.backendReady() || this.isClosing()) return;

    this.backendReady.set(true);
    this.stopSlideRotation();
    this.stopProgress();

    if (kind === 'minimal') {
      this.closingVariant.set('minimal');
      this.isClosing.set(true);
      this.completeTimeout = setTimeout(() => {
        onDone();
        this.isClosing.set(false);
        this.closingVariant.set(null);
        this.backendReady.set(false);
      }, 180);
      return;
    }

    this.closingVariant.set('splash');
    this.completeAndDismiss(onDone);
  }

  private resetSession(): void {
    this.progress.set(0);
    this.isClosing.set(false);
    this.isStalled.set(false);
    this.backendReady.set(false);
    this.closingVariant.set(null);
    this.startedAt.set(Date.now());
    this.shuffledIndices = this.shuffleIndices(LOADER_SHOWCASE_SLIDES.length);
    this.slideIndex.set(0);
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

  private completeAndDismiss(onDone: () => void): void {
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
          onDone();
          this.isClosing.set(false);
          this.closingVariant.set(null);
          this.backendReady.set(false);
        }, 200);
      }
    };

    requestAnimationFrame(animate);
  }

  private startSlideRotation(): void {
    this.stopSlideRotation();
    this.slideInterval = setInterval(() => {
      if (this.isClosing()) return;
      this.slideIndex.update((i) => (i + 1) % this.shuffledIndices.length);
    }, SLIDE_ROTATE_MS);
  }

  private stopSlideRotation(): void {
    if (this.slideInterval) {
      clearInterval(this.slideInterval);
      this.slideInterval = null;
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
