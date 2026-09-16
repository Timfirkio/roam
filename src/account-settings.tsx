import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { EnvelopeSimple, GoogleLogo } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { supabase } from './supabase';
import { syncAccountProgress } from './cloud-sync';
import { loadDiscoveredSegments } from './discovery-store';
import { loadSessions } from './session-store';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Spinner } from '@/components/ui/spinner';

const LAST_ACCOUNT_SYNC_STORAGE_KEY = 'roam:last-account-sync-at';

export function AccountSettings() {
  const client = supabase;
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const [localReady, setLocalReady] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() => localStorage.getItem(LAST_ACCOUNT_SYNC_STORAGE_KEY));
  const native = Capacitor.isNativePlatform();

  const sync = async (account: User) => {
    setBusy(true);
    setMessage('');
    setSyncProgress('Preparing local progress…');
    try {
      const result = await syncAccountProgress(account.id, progress => setSyncProgress(progress.label));
      window.dispatchEvent(new CustomEvent('roam:account-sync-complete', { detail: result }));
      const completedAt = new Date().toISOString();
      localStorage.setItem(LAST_ACCOUNT_SYNC_STORAGE_KEY, completedAt);
      setLastSyncedAt(completedAt);
      setMessage(`Synced ${result.discoveries.length} discoveries and ${result.sessions.length} rides.`);
    } catch (error) {
      const supabaseError = error && typeof error === 'object' ? error as { message?: unknown; details?: unknown } : null;
      const message = error instanceof Error
        ? error.message
        : [supabaseError?.message, supabaseError?.details].filter((value): value is string => typeof value === 'string').join(' ');
      setMessage(message || 'Sync failed; device progress is safe.');
    } finally {
      setSyncProgress(null);
      setBusy(false);
    }
  };

  useEffect(() => { void Promise.all([loadDiscoveredSegments(), loadSessions()]).finally(() => setLocalReady(true)); }, []);
  useEffect(() => {
    if (!client) return;
    void client.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, [client]);
  useEffect(() => {
    if (!client || !native) return;
    const handleCallback = async (url: string) => {
      try {
        const callback = new URL(url);
        const code = callback.searchParams.get('code');
        const hash = new URLSearchParams(callback.hash.slice(1));
        const callbackError = callback.searchParams.get('error_description') ?? hash.get('error_description');
        let error: Error | null = callbackError ? new Error(callbackError) : null;
        let account: User | null = null;
        if (code) {
          const result = await client.auth.exchangeCodeForSession(code);
          error = result.error;
          account = result.data.user;
        } else if (hash.get('access_token') && hash.get('refresh_token')) {
          const result = await client.auth.setSession({ access_token: hash.get('access_token')!, refresh_token: hash.get('refresh_token')! });
          error = result.error;
          account = result.data.user;
        } else if (!error) error = new Error('The sign-in callback did not include a session. Please try again.');
        await Browser.close();
        if (error) setMessage(error.message);
        else if (account) await sync(account);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Could not complete Google sign-in.');
      } finally {
        setBusy(false);
      }
    };
    const listener = CapacitorApp.addListener('appUrlOpen', ({ url }) => void handleCallback(url));
    void CapacitorApp.getLaunchUrl().then(result => { if (result?.url) void handleCallback(result.url); });
    return () => { void listener.then(handle => handle.remove()); };
  }, [client, native]);

  if (!client) return null;

  const auth = async (create: boolean) => {
    setBusy(true);
    const result = create
      ? await client.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
      : await client.auth.signInWithPassword({ email, password });
    if (result.error) {
      setMessage(result.error.message);
      setBusy(false);
    } else if (result.data.user && result.data.session) {
      setEmailDialogOpen(false);
      await sync(result.data.user);
    } else {
      setMessage('Check your email to verify, then log in.');
      setEmailDialogOpen(false);
      setBusy(false);
    }
  };
  const google = async () => {
    setBusy(true);
    const { data, error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: native ? 'com.roam.exploration://auth/callback' : window.location.origin, skipBrowserRedirect: native } });
    if (error) {
      setMessage(error.message);
      setBusy(false);
    } else if (native && data.url) {
      await Browser.open({ url: data.url });
    }
  };

  return <>
    <section className="rounded-panel border border-border bg-surface-raised px-4 text-text">
      <p className="roam-overline -mx-4 border-b border-border-muted px-4 py-3 text-accent">Account</p>
      {user ? <div className="space-y-2 py-4">
        <p className="text-body text-text-muted">Signed in as {user.email}</p>
        {lastSyncedAt && <p className="text-body text-text-muted">Last synced {new Date(lastSyncedAt).toLocaleString()}</p>}
        <Button className="w-full" variant="secondary" disabled={busy || !localReady} onClick={() => void sync(user)}>{busy ? <><Spinner />{syncProgress ?? 'Syncing progress…'}</> : 'Sync now'}</Button>
        <Button className="w-full" variant="ghost" disabled={busy} onClick={() => void client.auth.signOut()}>Sign out</Button>
      </div> : <div className="space-y-2 py-4">
        <Button className="w-full" size="medium" variant="secondary" disabled={busy || !localReady} onClick={() => void google()}><GoogleLogo aria-hidden="true" weight="bold" />Continue with Google</Button>
        <Button className="w-full" size="medium" variant="secondary" disabled={busy || !localReady} onClick={() => setEmailDialogOpen(true)}><EnvelopeSimple aria-hidden="true" weight="bold" />Continue with email</Button>
      </div>}
      {!localReady && <p className="pb-4 text-body text-text-muted">Loading local progress…</p>}
      {busy && syncProgress && <p className="pb-4 text-body text-text-muted" role="status">{syncProgress}</p>}
      {message && <p className="pb-4 text-body text-text-muted">{message}</p>}
    </section>
    <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
      <DialogContent>
        <DialogTitle>Use your email</DialogTitle>
        <DialogDescription>Create an account or log in with an existing email and password.</DialogDescription>
        <div className="mt-5 space-y-3">
          <label className="sr-only" htmlFor="account-email">Email</label>
          <input id="account-email" className="min-h-control w-full rounded-control border border-border bg-surface px-3 text-body text-text outline-none focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-focus" type="email" placeholder="Email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" />
          <label className="sr-only" htmlFor="account-password">Password</label>
          <input id="account-password" className="min-h-control w-full rounded-control border border-border bg-surface px-3 text-body text-text outline-none focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-focus" type="password" placeholder="Password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" />
          <Button className="w-full" disabled={busy || !email || !password || !localReady} onClick={() => void auth(false)}>Log in</Button>
          <Button className="w-full" variant="secondary" disabled={busy || !email || !password || !localReady} onClick={() => void auth(true)}>Create account</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
