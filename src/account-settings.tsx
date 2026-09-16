import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { supabase } from './supabase';
import { syncAccountProgress } from './cloud-sync';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';

export function AccountSettings() {
  const client = supabase;
  const [user, setUser] = useState<User | null>(null); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const native = Capacitor.isNativePlatform();
  const sync = async (account: User) => { setBusy(true); try { await syncAccountProgress(account.id); setMessage('Progress synced.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Sync failed; device progress is safe.'); } finally { setBusy(false); } };
  useEffect(() => { if (!client) return; void client.auth.getUser().then(({ data }) => setUser(data.user)); const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null)); return () => subscription.unsubscribe(); }, [client]);
  useEffect(() => { if (!client || !native) return; const listener = CapacitorApp.addListener('appUrlOpen', async ({ url }) => { const callback = new URL(url); const code = callback.searchParams.get('code'); if (!code) return; const { data, error } = await client.auth.exchangeCodeForSession(code); await Browser.close(); if (error) setMessage(error.message); else if (data.user) void sync(data.user); }); return () => { void listener.then(handle => handle.remove()); }; }, [client, native]);
  if (!client) return null;
  const auth = async (create: boolean) => { setBusy(true); const result = create ? await client.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } }) : await client.auth.signInWithPassword({ email, password }); if (result.error) setMessage(result.error.message); else if (result.data.user && result.data.session) await sync(result.data.user); else { setMessage('Check your email to verify, then sign in.'); setBusy(false); } };
  const google = async () => { setBusy(true); const { data, error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: native ? 'com.roam.exploration://auth/callback' : window.location.origin, skipBrowserRedirect: native } }); if (error) { setMessage(error.message); setBusy(false); } else if (native && data.url) await Browser.open({ url: data.url }); };
  return <section className="bg-surface px-6 pb-8 text-text sm:px-8"><div className="mx-auto max-w-2xl rounded-panel border border-border bg-surface-raised px-4"><p className="-mx-4 border-b border-border-muted px-4 py-3 font-mono text-overline font-semibold tracking-[0.14em] text-accent">ACCOUNT</p>{user ? <div className="space-y-3 py-4"><p className="text-body text-text-muted">Signed in as {user.email}</p><Button size="sm" variant="secondary" disabled={busy} onClick={() => void sync(user)}>SYNC NOW</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void client.auth.signOut()}>SIGN OUT</Button></div> : <div className="space-y-3 py-4"><input className="min-h-control w-full rounded-control border border-border bg-surface px-3 text-body" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} /><input className="min-h-control w-full rounded-control border border-border bg-surface px-3 text-body" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} /><Button size="sm" disabled={busy || !email || !password} onClick={() => void auth(true)}>CREATE ACCOUNT</Button><Button size="sm" variant="secondary" disabled={busy || !email || !password} onClick={() => void auth(false)}>SIGN IN</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void google()}>GOOGLE</Button></div>}{message && <p className="pb-4 text-body text-text-muted">{message}</p>}</div></section>;
}
