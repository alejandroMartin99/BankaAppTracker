import { Injectable, computed, effect, signal } from '@angular/core';
import { AuthService } from './auth.service';

export type AppTheme = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly storageKey = 'banka.theme';
  private readonly themeState = signal<AppTheme>('light');
  readonly theme = computed(() => this.themeState());
  readonly isDark = computed(() => this.themeState() === 'dark');

  constructor(private auth: AuthService) {
    const cached = this.readLocalTheme();
    if (cached) this.themeState.set(cached);
    this.applyThemeClass(this.themeState());

    effect(() => {
      const user = this.auth.user();
      if (!user) return;
      const preferred = this.auth.preferredTheme();
      this.setTheme(preferred, false);
    });
  }

  async toggleTheme(): Promise<void> {
    const next: AppTheme = this.themeState() === 'dark' ? 'light' : 'dark';
    this.setTheme(next, true);
    const { error } = await this.auth.updateProfile('', '', next);
    if (error) {
      this.setTheme(this.auth.preferredTheme(), true);
    }
  }

  private setTheme(theme: AppTheme, persistLocal: boolean): void {
    this.themeState.set(theme);
    this.applyThemeClass(theme);
    if (persistLocal) {
      localStorage.setItem(this.storageKey, theme);
    }
  }

  private applyThemeClass(theme: AppTheme): void {
    const root = document.documentElement;
    root.classList.toggle('theme-dark', theme === 'dark');
  }

  private readLocalTheme(): AppTheme | null {
    const raw = localStorage.getItem(this.storageKey);
    return raw === 'dark' || raw === 'light' ? raw : null;
  }
}
