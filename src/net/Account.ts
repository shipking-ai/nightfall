import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { SaveData } from '../core/SaveState';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY_ = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const STORAGE_KEY = 'nightfall.auth';

export type Role = 'player' | 'moderator' | 'admin';

/** What the character looks like; filled in by character customization. */
export type Look = Record<string, unknown>;

export interface Profile {
  id: string;
  name: string;
  look: Look;
  role: Role;
  banned: boolean;
}

/**
 * Optional accounts (Supabase Auth). Guests play exactly as before; signing in
 * keeps your name, look and progress on every device. Email + password, a
 * magic link, or Google. The Supabase client is only downloaded when it's
 * needed: an existing session, a sign-in link being opened, or the form.
 */
export class Account {
  readonly enabled = !!(URL_ && KEY_);
  user: User | null = null;
  profile: Profile | null = null;
  onChange: (() => void) | null = null;
  private sb: SupabaseClient | null = null;
  private loading: Promise<SupabaseClient> | null = null;

  /** At boot: pick up an existing session, or finish a magic-link / Google sign-in. */
  async init() {
    if (!this.enabled) return;
    const q = new URLSearchParams(location.search);
    const returning = q.has('code') || location.hash.includes('access_token') || q.has('error_description');
    let stored = false;
    try {
      stored = !!localStorage.getItem(STORAGE_KEY);
    } catch {
      /* private mode */
    }
    if (!returning && !stored) return;
    const sb = await this.client();
    if (returning) {
      // detectSessionInUrl exchanges the code; then tidy the address bar (keep ?room=)
      await sb.auth.getSession();
      const u = new URL(location.href);
      for (const k of ['code', 'error', 'error_code', 'error_description']) u.searchParams.delete(k);
      u.hash = '';
      history.replaceState(null, '', u.toString());
    }
    await this.refresh();
  }

  get signedIn(): boolean {
    return !!this.user;
  }

  get isStaff(): boolean {
    return !!this.profile && !this.profile.banned && (this.profile.role === 'admin' || this.profile.role === 'moderator');
  }

  async signUp(email: string, password: string, name: string): Promise<string> {
    const sb = await this.client();
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name: name.trim().slice(0, 24) }, emailRedirectTo: this.returnTo() } });
    if (error) throw new Error(friendly(error.message));
    if (!data.session) return 'Check your email to confirm the account, then sign in.';
    await this.refresh();
    return 'Account made. You’re signed in.';
  }

  async signIn(email: string, password: string): Promise<string> {
    const sb = await this.client();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(friendly(error.message));
    await this.refresh();
    return 'Signed in.';
  }

  async magicLink(email: string): Promise<string> {
    const sb = await this.client();
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: this.returnTo() } });
    if (error) throw new Error(friendly(error.message));
    return 'Sent. Open the link in that email on this device.';
  }

  async google(): Promise<void> {
    const sb = await this.client();
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: this.returnTo() } });
    if (error) throw new Error(friendly(error.message));
    // the browser now leaves for Google and comes back with ?code=
  }

  async signOut() {
    if (!this.sb) return;
    await this.sb.auth.signOut();
    this.user = null;
    this.profile = null;
    this.onChange?.();
  }

  /** Change your name and/or look. */
  async saveProfile(patch: { name?: string; look?: Look }) {
    if (!this.sb || !this.user || !this.profile) return;
    const next: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) next.name = patch.name.trim().slice(0, 24) || this.profile.name;
    if (patch.look !== undefined) next.look = patch.look;
    const { error } = await this.sb.from('profiles').update(next).eq('id', this.user.id);
    if (error) throw new Error(friendly(error.message));
    Object.assign(this.profile, next);
    this.onChange?.();
  }

  async loadSave(): Promise<SaveData | null> {
    if (!this.sb || !this.user) return null;
    const { data } = await this.sb.from('account_saves').select('data').eq('user_id', this.user.id).maybeSingle();
    return (data?.data as SaveData) ?? null;
  }

  async putSave(save: SaveData) {
    if (!this.sb || !this.user) return;
    await this.sb.from('account_saves').upsert({ user_id: this.user.id, data: save, updated_at: new Date().toISOString() });
  }

  /** The signed-in user's access token (for the room server and admin calls). */
  async token(): Promise<string | null> {
    if (!this.sb) return null;
    const { data } = await this.sb.auth.getSession();
    return data.session?.access_token ?? null;
  }

  /** The Supabase client, for features that need the signed-in user's database access (admin tools). */
  async supabase(): Promise<SupabaseClient> {
    return this.client();
  }

  private async refresh() {
    const sb = this.sb!;
    const { data } = await sb.auth.getUser();
    this.user = data.user ?? null;
    this.profile = null;
    if (this.user) {
      const { data: p } = await sb.from('profiles').select('id, name, look, role, banned').eq('id', this.user.id).maybeSingle();
      this.profile = (p as Profile) ?? null;
    }
    this.onChange?.();
  }

  private returnTo() {
    const u = new URL(location.href);
    u.hash = '';
    return u.toString();
  }

  private client(): Promise<SupabaseClient> {
    if (this.sb) return Promise.resolve(this.sb);
    if (!this.loading) {
      this.loading = import('@supabase/supabase-js').then(({ createClient }) => {
        const sb = createClient(URL_!, KEY_!, {
          auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: STORAGE_KEY },
        });
        sb.auth.onAuthStateChange((event) => {
          if (event === 'SIGNED_OUT') {
            this.user = null;
            this.profile = null;
            this.onChange?.();
          } else if (event === 'SIGNED_IN' && !this.user) this.refresh();
        });
        this.sb = sb;
        return sb;
      });
    }
    return this.loading;
  }
}

/** Supabase's messages, in the game's voice. */
function friendly(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'That email and password don’t match.';
  if (/already registered|already exists/i.test(msg)) return 'There’s already an account with that email. Sign in instead.';
  if (/password should be at least/i.test(msg)) return 'The password needs at least 6 characters.';
  if (/rate limit|too many/i.test(msg)) return 'Too many tries. Wait a minute and try again.';
  if (/email not confirmed/i.test(msg)) return 'Confirm your email first (check your inbox).';
  if (/provider is not enabled/i.test(msg)) return 'Google sign-in isn’t switched on yet.';
  if (/unable to validate email|invalid email/i.test(msg)) return 'That email address doesn’t look right.';
  return msg;
}
