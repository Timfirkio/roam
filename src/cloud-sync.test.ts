import { beforeEach, expect, it, vi } from 'vitest';
import type { DeletedSession, RideSession } from './session-store';

const state = vi.hoisted(() => ({
  localSessions: [] as RideSession[],
  localDeletions: [] as DeletedSession[],
  cloudRows: [] as Record<string, any>[],
  deletedPointIds: [] as string[],
  uploadedSessionIds: [] as string[],
}));

vi.mock('./discovery-store', () => ({
  loadDiscoveredSegments: async () => [],
  replaceDiscoveredSegments: async () => {},
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
  const query = {
    select: () => query,
    eq: (column: string, value: string) => { if (column === 'id' || column === 'session_id') sessionId = value; return query; },
    is: (column: string) => { if (column === 'deleted_at') deletedFilter = 'active'; return query; },
    not: (column: string) => { if (column === 'deleted_at') deletedFilter = 'deleted'; return query; },
    order: () => query,
    range: () => query,
    update: (value: any) => { operation = 'update'; payload = value; return query; },
    delete: () => { operation = 'delete'; return query; },
    upsert: (value: any) => { operation = 'upsert'; payload = value; return query; },
    insert: () => { operation = 'insert'; return query; },
    then: (resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve().then(() => {
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
        return { data: null, error: null };
      }
      if (table === 'ride_sessions') return { data: state.cloudRows.filter(row => deletedFilter === 'deleted' ? row.deleted_at !== null : row.deleted_at === null), error: null };
      return { data: [], error: null };
    }).then(resolve, reject),
  };
  return query;
} }) }));

import { syncAccountProgress } from './cloud-sync';

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
  state.localSessions = [];
  state.localDeletions = [];
  state.cloudRows = [];
  state.deletedPointIds = [];
  state.uploadedSessionIds = [];
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
