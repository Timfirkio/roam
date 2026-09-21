import { supabase } from './supabase';
import type { AreaLookup, AreaRecord } from './area-types';

export type LocationSearchResult = { id: string; name: string; lng: number; lat: number; type: string };

// The hosted catalog is the production default. Deployments may override it for
// development or another environment through VITE_AREA_API_URL.
export const areaApiBase = (import.meta.env.VITE_AREA_API_URL ?? 'https://areas.timplummer.co/api/areas').replace(/\/$/, '');
async function request<T>(path: string, method = 'GET', signal?: AbortSignal): Promise<T> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  const response = await fetch(`${areaApiBase}${path}`, {
    method, signal, headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
  });
  let body;
  try { body = await response.json(); }
  catch { throw new Error('Area coverage is not available yet. Try again when the area service is connected.'); }
  if (!response.ok) throw new Error(body.error ?? 'Area service unavailable. Try again later.');
  return body as T;
}
export const lookupAreas = (lng: number, lat: number, signal?: AbortSignal) => request<AreaLookup>(`/lookup?lng=${lng}&lat=${lat}`, 'GET', signal);
export const loadArea = (id: string, signal?: AbortSignal, geometry = false) => request<AreaRecord>(`/${id}?geometry=${geometry}`, 'GET', signal);
export const calculateArea = (id: string, automatic = false, signal?: AbortSignal) => request<AreaRecord>(`/${id}/calculate?automatic=${automatic}`, 'POST', signal);
export const searchLocations = (query: string, signal?: AbortSignal) => request<{ results: LocationSearchResult[] }>(`/search?q=${encodeURIComponent(query)}`, 'GET', signal);
