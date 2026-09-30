import type { DiscoveredSegment } from './discovery';
import type { SessionPoint } from './session-store';

export type SessionRouteRequest = { id: number; points: SessionPoint[] };
export type SessionRouteResult = { id: number; route?: DiscoveredSegment[]; error?: string };

let worker: Worker | null = null;
let nextId = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const requests = new Map<number, { resolve: (route: DiscoveredSegment[]) => void; reject: (error: Error) => void }>();

function releaseWhenIdle() {
  if (requests.size) return;
  idleTimer = setTimeout(() => { worker?.terminate(); worker = null; }, 30_000);
}

/** Fetch, decode and match network geometry away from the navigation/UI thread. */
export function loadSessionRoute(points: SessionPoint[]): Promise<DiscoveredSegment[]> {
  clearTimeout(idleTimer);
  return new Promise((resolve, reject) => {
    if (!worker) {
      worker = new Worker(new URL('./session-route-worker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', ({ data }: MessageEvent<SessionRouteResult>) => {
        const request = requests.get(data.id);
        if (!request) return;
        requests.delete(data.id);
        if (data.error || !data.route) request.reject(new Error(data.error ?? 'No session route returned.'));
        else request.resolve(data.route);
        releaseWhenIdle();
      });
      worker.addEventListener('error', () => {
        worker?.terminate();
        worker = null;
        for (const request of requests.values()) request.reject(new Error('Could not calculate the session route.'));
        requests.clear();
      });
    }
    const id = ++nextId;
    requests.set(id, { resolve, reject });
    try { worker.postMessage({ id, points } satisfies SessionRouteRequest); }
    catch (error) { requests.delete(id); reject(error); releaseWhenIdle(); }
  });
}
