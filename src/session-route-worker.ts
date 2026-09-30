import { reconcileSessionRoute } from './session-route-reconciliation';
import type { SessionRouteRequest, SessionRouteResult } from './session-route-client';

// Serialize requests to bound tile downloads and CPU use when switching rides.
let queue = Promise.resolve();
self.addEventListener('message', ({ data }: MessageEvent<SessionRouteRequest>) => {
  queue = queue.then(async () => {
    try {
      const route = await reconcileSessionRoute(data.points, new Set(), true);
      self.postMessage({ id: data.id, route } satisfies SessionRouteResult);
    } catch (error) {
      self.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'Could not calculate the session route.' } satisfies SessionRouteResult);
    }
  });
});
