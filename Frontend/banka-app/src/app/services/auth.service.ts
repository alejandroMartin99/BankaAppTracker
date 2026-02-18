import { Injectable, signal, computed } from '@angular/core';
import { createClient, Session, SupabaseClient, User } from '@supabase/supabase-js';
import { environment } from '../../environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private supabase: SupabaseClient;
  private session = signal<Session | null>(null);

  /** Promesa que se resuelve cuando la sesión inicial está cargada (desde storage) */
  readonly sessionReady: Promise<void>;

  readonly user = computed(() => this.session()?.user ?? null);
  readonly isAuthenticated = computed(() => !!this.session()?.user);
  /** Nombre para mostrar (full_name, name, o parte del email) */
  readonly displayName = computed(() => {
    const u = this.session()?.user;
    if (!u) return '';
    const meta = u.user_metadata;
    return (meta?.['full_name'] || meta?.['name'] || meta?.['user_name'] || '')?.trim()
      || (u.email ? u.email.split('@')[0] : '');
  });
  readonly accessToken = computed(() => this.session()?.access_token ?? null);

  constructor() {
    this.supabase = createClient(
      environment.supabaseUrl,
      environment.supabaseAnonKey
    );
    this.sessionReady = this.supabase.auth.getSession().then(({ data: { session } }) => {
      this.session.set(session);
    });
    this.supabase.auth.onAuthStateChange((_event, session) => {
      this.session.set(session);
    });
  }

  async signIn(email: string, password: string): Promise<{ error: Error | null }> {
    const { error } = await this.supabase.auth.signInWithPassword({ email, password });
    return { error };
  }

  async signUp(email: string, password: string, fullName?: string): Promise<{ error: Error | null }> {
    const options = fullName?.trim()
      ? { data: { full_name: fullName.trim() } }
      : undefined;
    const { error } = await this.supabase.auth.signUp({ email, password, options });
    return { error };
  }

  async signOut(): Promise<void> {
    this.session.set(null); // Limpiar de inmediato para que isAuthenticated() sea false antes de navegar
    await this.supabase.auth.signOut();
  }

  /** Obtiene el token actual (refresca la sesión si es necesario). Útil para el interceptor. */
  async getAccessToken(): Promise<string | null> {
    const { data: { session } } = await this.supabase.auth.getSession();
    return session?.access_token ?? null;
  }
}
