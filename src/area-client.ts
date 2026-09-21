import { supabase } from './supabase';
import type { AreaLookup, AreaRecord } from './area-types';

const base = (import.meta.env.VITE_AREA_API_URL ?? '/api/areas').replace(/\/$/, '');
async function request<T>(path: string, method = 'GET', signal?: AbortSignal): Promise<T> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  const response = await fetch(`${base}${path}`, {
    method, signal, headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
  });
  let body;
  try { body = await response.json(); }
  catch { throw new Error('Area coverage is not available yet. Try again when the area service is connected.'); }
  if (!response.ok) throw new Error(body.error ?? 'Area service unavailable. Try again later.');
  return body as T;
}
export const lookupAreas = (lng: number, lat: number, signal?: AbortSignal) => request<AreaLookup>(`/lookup?lng=${lng}&lat=${lat}`, 'GET', signal);
export const loadArea = (id: string, signal?: AbortSignal) => request<AreaRecord>(`/${id}`, 'GET', signal);
export const calculateArea = (id: string, automatic = false, signal?: AbortSignal) => request<AreaRecord>(`/${id}/calculate?automatic=${automatic}`, 'POST', signal);
