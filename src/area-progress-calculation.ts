import type { AreaGeometry, AreaTotals } from './area-types';
import type { DiscoveredSegment } from './discovery';

const totalsCache = new Map<string, AreaTotals>();
const pending = new Map<string, Promise<AreaTotals>>();
const discoveryVersions = new WeakMap<DiscoveredSegment[], string>();
let worker: Worker | null = null;
let nextRequestId = 0;
const requests = new Map<number, { resolve: (totals: AreaTotals) => void; reject: (error: Error) => void }>();

function discoveryVersion(discoveries: DiscoveredSegment[]) {
  const cached = discoveryVersions.get(discoveries);
  if (cached) return cached;
  const latest = discoveries.at(-1);
  const version = `${discoveries.length}:${latest?.id ?? ''}:${latest?.discoveredAt ?? 0}`;
  discoveryVersions.set(discoveries, version);
  return version;
}

export function exploredTotalsKey(discoveries: DiscoveredSegment[], areaKey: string) {
  return `${areaKey}:${discoveryVersion(discoveries)}`;
}

export function cachedExploredTotals(key: string) {
  const memory = totalsCache.get(key);
  if (memory) return memory;
  try {
    const stored = localStorage.getItem(`roam.area-progress.${key}`);
    if (!stored) return undefined;
    const totals = JSON.parse(stored) as AreaTotals;
    if (!Number.isFinite(totals.lengthMeters)) return undefined;
    totalsCache.set(key, totals);
    return totals;
  } catch { return undefined; }
}

export function calculateExploredAreaTotals(discoveries: DiscoveredSegment[], geometry: AreaGeometry, key: string): Promise<AreaTotals> {
  const cached = cachedExploredTotals(key);
  if (cached) return Promise.resolve(cached);
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
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
    worker?.postMessage({ id, discoveries, geometry });
  }).then(totals => {
    totalsCache.set(key, totals);
    try { localStorage.setItem(`roam.area-progress.${key}`, JSON.stringify(totals)); } catch {}
    return totals;
  }).finally(() => pending.delete(key));
  pending.set(key, result);
  return result;
}
