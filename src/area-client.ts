import { supabase } from './supabase';
import type { AreaLookup, AreaRecord } from './area-types';

export type LocationSearchResult = { id: string; name: string; lng: number; lat: number; type: string };

// Development calls the catalog through Vite so the hosted API's production
// CORS policy does not prevent localhost from loading regions. A configured
// local worker can replace that proxy through AREA_API_PROXY_TARGET.
export const areaApiBase = (import.meta.env.VITE_AREA_API_URL ?? (import.meta.env.DEV ? '/api/areas' : 'https://areas.timplummer.co/api/areas')).replace(/\/$/, '');
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
