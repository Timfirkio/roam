import type { AreaGeometry, AreaTotals } from './area-types';
import type { DiscoveredSegment } from './discovery';
import { areaDiscoverySignature, discoveriesNearArea, emptyAreaTotals } from './area-geometry';

const totalsCache = new Map<string, AreaTotals>();
const pending = new Map<string, Promise<AreaTotals>>();
const recentAreaTotals = new Map<string, { totals: AreaTotals; discoveryIds: Set<string> }>();
let worker: Worker | null = null;
let nextRequestId = 0;
const requests = new Map<number, { resolve: (totals: AreaTotals) => void; reject: (error: Error) => void }>();
const storageKey = (areaKey: string) => `roam.area-progress.current.${areaKey}`;

/** Last saved value for immediate display while account discoveries sync. */
export function latestExploredAreaTotals(areaKey: string): AreaTotals | null {
  try {
    const stored = localStorage.getItem(storageKey(areaKey));
    const entry = stored ? JSON.parse(stored) as { totals?: AreaTotals } : null;
    const totals = entry?.totals;
    return totals && Number.isFinite(totals.lengthMeters)
      && ['paved-road', 'cycleway', 'unpaved-path'].every(type => Number.isFinite(totals.byRoadType?.[type as keyof AreaTotals['byRoadType']]))
      ? totals : null;
  } catch { return null; }
}

function persistTotals(key: string, areaKey: string, totals: AreaTotals) {
  try {
    localStorage.setItem(storageKey(areaKey), JSON.stringify({ key, totals }));
    return true;
  } catch { return false; }
}

export function exploredTotalsKey(discoveries: DiscoveredSegment[], areaKey: string, geometry: AreaGeometry) {
  const nearby = discoveriesNearArea(discoveries, geometry);
  let hash = 2166136261;
  for (const segment of [...nearby].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) {
    for (const character of `${areaDiscoverySignature(segment)};`) {
      hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    }
  }
  return `${areaKey}:v2:${nearby.length}:${(hash >>> 0).toString(36)}`;
}

export function rememberExploredAreaTotals(areaKey: string, discoveries: DiscoveredSegment[], geometry: AreaGeometry, totals: AreaTotals) {
  recentAreaTotals.set(areaKey, { totals, discoveryIds: new Set(discoveriesNearArea(discoveries, geometry).map(segment => segment.id)) });
}

/** Reuse the last result while additional discoveries for the same area are measured. */
export function previousExploredAreaTotals(areaKey: string, discoveries: DiscoveredSegment[], geometry: AreaGeometry) {
  const recent = recentAreaTotals.get(areaKey);
  if (!recent) return undefined;
  const currentIds = new Set(discoveriesNearArea(discoveries, geometry).map(segment => segment.id));
  return [...recent.discoveryIds].every(id => currentIds.has(id)) ? recent.totals : undefined;
}

export function cachedExploredTotals(key: string, areaKey: string) {
  const memory = totalsCache.get(key);
  if (memory) return memory;
  try {
    const current = localStorage.getItem(storageKey(areaKey));
    const entry = current ? JSON.parse(current) as { key: string; totals: AreaTotals } : null;
    const legacy = entry?.key === key ? null : localStorage.getItem(`roam.area-progress.${key}`);
    const totals = entry?.key === key ? entry.totals : legacy ? JSON.parse(legacy) as AreaTotals : null;
    if (!totals) return undefined;
    if (!Number.isFinite(totals.lengthMeters)) return undefined;
    totalsCache.set(key, totals);
    if (legacy && persistTotals(key, areaKey, totals)) {
      localStorage.removeItem(`roam.area-progress.${key}`);
    }
    return totals;
  } catch { return undefined; }
}

export function calculateExploredAreaTotals(discoveries: DiscoveredSegment[], geometry: AreaGeometry, key: string, areaKey: string): Promise<AreaTotals> {
  const cached = cachedExploredTotals(key, areaKey);
  if (cached) { rememberExploredAreaTotals(areaKey, discoveries, geometry, cached); return Promise.resolve(cached); }
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const nearby = discoveriesNearArea(discoveries, geometry);
  if (!nearby.length) {
    const totals = emptyAreaTotals();
    totalsCache.set(key, totals);
    rememberExploredAreaTotals(areaKey, discoveries, geometry, totals);
    persistTotals(key, areaKey, totals);
    return Promise.resolve(totals);
  }
  if (!worker) {
    worker = new Worker(new URL('./area-progress-worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', ({ data }: MessageEvent<{ id: number; totals?: AreaTotals; error?: string }>) => {
      const request = requests.get(data.id);
      if (!request) return;
      requests.delete(data.id);
      if (!data.totals || data.error) { request.reject(new Error(data.error ?? 'Could not calculate area progress.')); return; }
      request.resolve(data.totals);
    });
    worker.addEventListener('error', () => {
      for (const request of requests.values()) request.reject(new Error('Could not calculate area progress.'));
      requests.clear();
      worker?.terminate();
      worker = null;
    });
  }
  const id = ++nextRequestId;
  const result = new Promise<AreaTotals>((resolve, reject) => {
    requests.set(id, { resolve, reject });
    worker?.postMessage({ id, areaKey, discoveries: nearby, geometry });
  }).then(totals => {
    totalsCache.set(key, totals);
    rememberExploredAreaTotals(areaKey, discoveries, geometry, totals);
    persistTotals(key, areaKey, totals);
    return totals;
  }).finally(() => pending.delete(key));
  pending.set(key, result);
  return result;
}
