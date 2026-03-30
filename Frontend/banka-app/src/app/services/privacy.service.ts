import { Injectable, signal } from '@angular/core';

const HIDE_BALANCES_KEY = 'hide_balances_enabled';

@Injectable({
  providedIn: 'root'
})
export class PrivacyService {
  readonly hideBalances = signal<boolean>(this.loadInitial());

  toggleHideBalances(): void {
    const next = !this.hideBalances();
    this.hideBalances.set(next);
    try {
      localStorage.setItem(HIDE_BALANCES_KEY, next ? '1' : '0');
    } catch {
      // ignore localStorage errors
    }
  }

  private loadInitial(): boolean {
    try {
      return localStorage.getItem(HIDE_BALANCES_KEY) === '1';
    } catch {
      return false;
    }
  }
}
