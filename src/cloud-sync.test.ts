import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DiscoveredSegment } from './discovery';
import type { DeletedSession, RideSession } from './session-store';

const state = vi.hoisted(() => ({
  localDiscoveries: [] as DiscoveredSegment[],
  cloudDiscoveries: [] as Record<string, any>[],
  duringCloudRead: null as (() => void) | null,
  localSessions: [] as RideSession[],
  localDeletions: [] as DeletedSession[],
  cloudRows: [] as Record<string, any>[],
  deletedPointIds: [] as string[],
  uploadedSessionIds: [] as string[],
  insertedPoints: [] as Record<string, any>[],
}));

vi.mock('./discovery-store', () => ({
  loadDiscoveredSegments: async () => [...state.localDiscoveries],
  replaceDiscoveredSegments: async (segments: DiscoveredSegment[]) => { state.localDiscoveries = segments; },
}));

vi.mock('./session-store', () => ({
  loadSessions: async () => [...state.localSessions],
  loadDeletedSessions: async () => [...state.localDeletions],
  recordDeletedSessions: async (deletions: DeletedSession[]) => {
    for (const deletion of deletions) {
      state.localSessions = state.localSessions.filter(session => session.id !== deletion.id);
      state.localDeletions = [...state.localDeletions.filter(row => row.id !== deletion.id), deletion];
    }
  },
  replaceSessions: async (sessions: RideSession[]) => {
    const deletedIds = new Set(state.localDeletions.map(row => row.id));
    state.localSessions = sessions.filter(session => !deletedIds.has(session.id));
  },
}));

vi.mock('./supabase', () => ({ requireSupabase: () => ({ from: (table: string) => {
  let operation = 'select';
  let payload: any;
  let deletedFilter: 'active' | 'deleted' | null = null;
  let sessionId: string | null = null;
  let range: [number, number] | null = null;
  const query = {
    select: () => query,
    eq: (column: string, value: string) => { if (column === 'id' || column === 'session_id') sessionId = value; return query; },
    is: (column: string) => { if (column === 'deleted_at') deletedFilter = 'active'; return query; },
    not: (column: string) => { if (column === 'deleted_at') deletedFilter = 'deleted'; return query; },
    order: () => query,
    range: (from: number, to: number) => { range = [from, to]; return query; },
    update: (value: any) => { operation = 'update'; payload = value; return query; },
    delete: () => { operation = 'delete'; return query; },
    upsert: (value: any) => { operation = 'upsert'; payload = value; return query; },
    insert: (value: any) => { operation = 'insert'; payload = value; return query; },
    then: (resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve().then(() => {
      if (table === 'discoveries' && operation === 'select') {
        const duringCloudRead = state.duringCloudRead;
        state.duringCloudRead = null;
        duringCloudRead?.();
        return { data: [...state.cloudDiscoveries], error: null };
      }
      if (table === 'discoveries' && operation === 'upsert') {
        state.cloudDiscoveries.push(...payload);
        return { data: null, error: null };
      }
      if (table === 'ride_sessions' && operation === 'update') {
        const row = state.cloudRows.find(candidate => candidate.id === sessionId && candidate.deleted_at === null);
        if (row) row.deleted_at = payload.deleted_at;
        return { data: null, error: null };
      }
      if (table === 'ride_sessions' && operation === 'upsert') {
        state.uploadedSessionIds.push(payload.id);
        return { data: null, error: null };
      }
      if (table === 'ride_session_points' && operation === 'delete') {
        state.deletedPointIds.push(sessionId!);
        const cloudSession = state.cloudRows.find(row => row.id === sessionId);
        if (cloudSession) cloudSession.ride_session_points = [];
        state.insertedPoints = state.insertedPoints.filter(point => point.session_id !== sessionId);
        return { data: null, error: null };
      }
      if (table === 'ride_session_points' && operation === 'insert') {
        state.insertedPoints.push(...payload);
        return { data: null, error: null };
      }
      if (table === 'ride_session_points' && operation === 'select') {
        const points = [...state.cloudRows.flatMap(row => row.ride_session_points ?? []), ...state.insertedPoints]
          .sort((a, b) => a.session_id.localeCompare(b.session_id) || a.sequence - b.sequence);
        return { data: range ? points.slice(range[0], range[1] + 1) : points.slice(0, 1_000), error: null };
      }
      if (table === 'ride_sessions') {
        const rows = state.cloudRows.filter(row => deletedFilter === 'deleted' ? row.deleted_at !== null : row.deleted_at === null);
        return { data: range ? rows.slice(range[0], range[1] + 1) : rows.slice(0, 1_000), error: null };
      }
      return { data: [], error: null };
    }).then(resolve, reject),
  };
  return query;
} }) }));

import { runAccountSync, syncAccountProgress } from './cloud-sync';

const session: RideSession = {
  id: 'ride-1', title: 'Ride', districtNames: [], startedAt: 1_000, endedAt: 2_000,
  durationSeconds: 1, distanceMeters: 100, newDistanceMeters: 20, points: [],
};

function cloudSession(deletedAt: string | null) {
  return {
    id: session.id, title: session.title, district_names: [], started_at: new Date(session.startedAt).toISOString(),
    ended_at: new Date(session.endedAt).toISOString(), duration_seconds: session.durationSeconds,
    distance_meters: session.distanceMeters, new_distance_meters: session.newDistanceMeters,
    ride_session_points: [], deleted_at: deletedAt,
  };
}

beforeEach(() => {
  state.localDiscoveries = [];
  state.cloudDiscoveries = [];
  state.duringCloudRead = null;
  state.localSessions = [];
  state.localDeletions = [];
  state.cloudRows = [];
  state.deletedPointIds = [];
  state.uploadedSessionIds = [];
  state.insertedPoints = [];
});

afterEach(() => vi.unstubAllGlobals());

function discovery(id: string, lengthMeters = 12): DiscoveredSegment {
  return { id, lengthMeters, roadType: 'cycleway', discoveredAt: 1_000, geometry: { type: 'LineString', coordinates: [[18, 59], [18.001, 59]] } };
}

function cloudDiscovery(segment: DiscoveredSegment) {
  return { segment_id: segment.id, road_type: segment.roadType, geometry: segment.geometry, length_meters: segment.lengthMeters, discovered_at: new Date(segment.discoveredAt).toISOString() };
}

async function syncEvent() {
  const dispatchEvent = vi.fn();
  vi.stubGlobal('window', { dispatchEvent });
  await runAccountSync('user-1');
  expect(dispatchEvent).toHaveBeenCalledOnce();
  return (dispatchEvent.mock.calls[0][0] as CustomEvent).detail;
}

it('does not report local GPS discoveries or a ride completed during sync as remote progress', async () => {
  state.duringCloudRead = () => {
    state.localDiscoveries.push(discovery('local-during-sync'));
    state.localSessions.push(session);
  };

  const detail = await syncEvent();

  expect(detail.addedDiscoveryMeters).toBe(0);
  expect(detail.addedRides).toBe(0);
  expect(detail.discoveries.map((item: DiscoveredSegment) => item.id)).toEqual(['local-during-sync']);
  expect(detail.sessions).toEqual([session]);
});

it('reports only remote additions when cloud and local progress arrive during the same sync', async () => {
  state.localDiscoveries = [discovery('local-before-sync')];
  state.cloudDiscoveries = [cloudDiscovery(discovery('remote', 24))];
  state.cloudRows = [{ ...cloudSession(null), id: 'remote-ride' }];
  state.duringCloudRead = () => {
    const local = discovery('local-during-sync');
    state.localDiscoveries.push(local);
    // Even a cloud echo of a discovery made here must stay silent.
    state.cloudDiscoveries.push(cloudDiscovery(local));
    state.localSessions.push(session);
  };

  const detail = await syncEvent();

  expect(detail.addedDiscoveryMeters).toBe(24);
  expect(detail.addedRides).toBe(1);
  expect(detail.discoveries).toHaveLength(3);
  expect(detail.sessions).toHaveLength(2);

  const repeated = await syncEvent();
  expect(repeated.addedDiscoveryMeters).toBe(0);
  expect(repeated.addedRides).toBe(0);
});

it('uploads a local deletion and removes the cloud GPS points', async () => {
  state.localDeletions = [{ id: session.id, deletedAt: 3_000 }];
  state.cloudRows = [cloudSession(null)];

  const result = await syncAccountProgress('user-1');

  expect(state.cloudRows[0].deleted_at).toBe(new Date(3_000).toISOString());
  expect(state.deletedPointIds).toEqual([session.id]);
  expect(state.localDeletions[0].synced).toBe(true);
  expect(result.sessions).toEqual([]);
});

it('removes a cloud-deleted ride from a second device without uploading it again', async () => {
  state.localSessions = [session];
  state.cloudRows = [cloudSession(new Date(3_000).toISOString())];

  const result = await syncAccountProgress('user-1');

  expect(result.sessions).toEqual([]);
  expect(state.localDeletions).toEqual([{ id: session.id, deletedAt: 3_000, synced: true }]);
  expect(state.uploadedSessionIds).toEqual([]);
});

it('reapplies a synced deletion if a stale device restores the cloud row', async () => {
  state.localDeletions = [{ id: session.id, deletedAt: 3_000, synced: true }];
  state.cloudRows = [cloudSession(null)];

  await syncAccountProgress('user-1');

  expect(state.cloudRows[0].deleted_at).toBe(new Date(3_000).toISOString());
  expect(state.uploadedSessionIds).toEqual([]);
});

it('loads every GPS point across cloud pages and keeps the complete ride locally', async () => {
  const points = Array.from({ length: 1_501 }, (_, sequence) => ({
    session_id: session.id, sequence, lat: 59 + sequence / 100_000, lng: 18,
    accuracy: 5, recorded_at: new Date(1_000 + sequence * 1_000).toISOString(), speed: null, bearing: null,
  }));
  state.cloudRows = [{ ...cloudSession(null), ride_session_points: points }];

  const result = await syncAccountProgress('user-1');

  expect(result.sessions).toHaveLength(1);
  expect(result.sessions[0].points).toHaveLength(1_501);
  expect(result.sessions[0].points[0].lat).toBe(points[0].lat);
  expect(result.sessions[0].points.at(-1)?.lat).toBe(points.at(-1)?.lat);
});

it('restores a complete local route when the cloud copy has only 1000 points', async () => {
  const points = Array.from({ length: 1_501 }, (_, sequence) => ({
    lat: 59 + sequence / 100_000, lng: 18, accuracy: 5, timestamp: 1_000 + sequence * 1_000,
  }));
  state.localSessions = [{ ...session, points }];
  state.cloudRows = [{ ...cloudSession(null), ride_session_points: points.slice(0, 1_000).map((point, sequence) => ({
    session_id: session.id, sequence, lat: point.lat, lng: point.lng, accuracy: point.accuracy,
    recorded_at: new Date(point.timestamp).toISOString(), speed: null, bearing: null,
  })) }];

  const result = await syncAccountProgress('user-1');

  expect(state.deletedPointIds).toEqual([session.id]);
  expect(state.insertedPoints).toHaveLength(1_501);
  expect(result.sessions[0].points).toHaveLength(1_501);
});
