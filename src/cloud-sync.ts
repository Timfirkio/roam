import type { DiscoveredSegment, RoadType } from './discovery';
import { loadDiscoveredSegments, replaceDiscoveredSegments } from './discovery-store';
import { loadSessions, replaceSessions, type RideSession, type SessionPoint } from './session-store';
import { requireSupabase } from './supabase';

const POINT_BATCH_SIZE = 250;
const DISCOVERY_BATCH_SIZE = 250;
const CLOUD_DISCOVERY_PAGE_SIZE = 1_000;

export type SyncProgress = {
  label: string;
};

function syncError(stage: string, error: unknown): Error {
  if (error instanceof Error) return new Error(`${stage}: ${error.message}`);
  if (error && typeof error === 'object') {
    const details = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const message = [details.message, details.details, details.hint].filter((value): value is string => typeof value === 'string' && value.length > 0).join(' ');
    const code = typeof details.code === 'string' ? ` (${details.code})` : '';
    if (message) return new Error(`${stage}: ${message}${code}`);
  }
  return new Error(`${stage}: ${String(error)}`);
}

/** Maps device records written before footpaths became part of the cycleway category. */
function normalizeRoadType(value: unknown): RoadType {
  if (value === 'paved-road' || value === 'cycleway' || value === 'unpaved-path') return value;
  if (value === 'footpath') return 'cycleway';
  throw new Error(`Could not sync a discovery with unsupported road type “${String(value)}”.`);
}

function toSession(row: any): RideSession {
  return {
    id: row.id, title: row.title, districtNames: row.district_names, startedAt: new Date(row.started_at).valueOf(), endedAt: new Date(row.ended_at).valueOf(),
    durationSeconds: row.duration_seconds, distanceMeters: row.distance_meters, newDistanceMeters: row.new_distance_meters,
    points: (row.ride_session_points ?? []).sort((a: any, b: any) => a.sequence - b.sequence).map((point: any): SessionPoint => ({
      lat: point.lat, lng: point.lng, accuracy: point.accuracy, timestamp: new Date(point.recorded_at).valueOf(), speed: point.speed, bearing: point.bearing,
    })),
  };
}

function samePoints(left: SessionPoint[], right: SessionPoint[]) {
  return left.length === right.length && left.every((point, index) => {
    const other = right[index];
    return point.lat === other.lat
      && point.lng === other.lng
      && point.accuracy === other.accuracy
      && point.timestamp === other.timestamp
      && (point.speed ?? null) === (other.speed ?? null)
      && (point.bearing ?? null) === (other.bearing ?? null);
  });
}

function sameSessionDetails(left: RideSession, right: RideSession) {
  return left.title === right.title
    && JSON.stringify(left.districtNames) === JSON.stringify(right.districtNames)
    && left.startedAt === right.startedAt
    && left.endedAt === right.endedAt
    && left.durationSeconds === right.durationSeconds
    && left.distanceMeters === right.distanceMeters
    && left.newDistanceMeters === right.newDistanceMeters;
}

/** Upload local progress, then replace the local cache with the account-wide union. */
export async function syncAccountProgress(userId: string, onProgress?: (progress: SyncProgress) => void) {
  const client = requireSupabase();
  const loadCloudDiscoveries = async () => {
    const rows: any[] = [];
    for (let offset = 0; ; offset += CLOUD_DISCOVERY_PAGE_SIZE) {
      const { data, error } = await client.from('discoveries').select('*').eq('user_id', userId).order('discovered_at').order('segment_id').range(offset, offset + CLOUD_DISCOVERY_PAGE_SIZE - 1);
      if (error) throw syncError('Could not load cloud discoveries', error);
      const page = data ?? [];
      rows.push(...page);
      if (page.length < CLOUD_DISCOVERY_PAGE_SIZE) return rows;
    }
  };
  onProgress?.({ label: 'Preparing local progress…' });
  const [discoveries, sessions] = await Promise.all([loadDiscoveredSegments(), loadSessions()]);
  onProgress?.({ label: 'Checking your account progress…' });
  const [initialCloudDiscoveries, initialCloudSessions] = await Promise.all([
    loadCloudDiscoveries(),
    client.from('ride_sessions').select('*, ride_session_points(*)').eq('user_id', userId).is('deleted_at', null).order('started_at', { ascending: false }),
  ]);
  if (initialCloudSessions.error) throw syncError('Could not load cloud rides', initialCloudSessions.error);
  let cloudDiscoveries = initialCloudDiscoveries;
  let cloudSessions = initialCloudSessions.data ?? [];

  const cloudDiscoveryIds = new Set(cloudDiscoveries.map((row: any) => row.segment_id));
  const discoveriesToUpload = discoveries.filter(segment => !cloudDiscoveryIds.has(segment.id));
  const cloudSessionsById = new Map<string, RideSession>(cloudSessions.map((row: any) => [row.id, toSession(row)]));
  const sessionsToUpload = sessions.filter(session => {
    const cloudSession = cloudSessionsById.get(session.id);
    return !cloudSession || !sameSessionDetails(session, cloudSession) || !samePoints(session.points, cloudSession.points);
  });

  const discoveryBatchCount = Math.ceil(discoveriesToUpload.length / DISCOVERY_BATCH_SIZE);
  let changedCloudData = false;
  for (let index = 0; index < discoveriesToUpload.length; index += DISCOVERY_BATCH_SIZE) {
    onProgress?.({ label: `Syncing discoveries ${index / DISCOVERY_BATCH_SIZE + 1} of ${discoveryBatchCount}…` });
    const { error } = await client.from('discoveries').upsert(discoveriesToUpload.slice(index, index + DISCOVERY_BATCH_SIZE).map(segment => ({
      user_id: userId, segment_id: segment.id, region_id: segment.regionId ?? null, region_name: segment.regionName ?? null,
      road_type: normalizeRoadType(segment.roadType), geometry: segment.geometry, length_meters: segment.lengthMeters, discovered_at: new Date(segment.discoveredAt).toISOString(),
    })), { onConflict: 'user_id,segment_id', ignoreDuplicates: true });
    if (error) throw syncError(`Could not upload discoveries batch ${index / DISCOVERY_BATCH_SIZE + 1}`, error);
    changedCloudData = true;
  }
  for (const [sessionIndex, session] of sessionsToUpload.entries()) {
    onProgress?.({ label: `Syncing rides ${sessionIndex + 1} of ${sessionsToUpload.length}…` });
    const cloudSession = cloudSessionsById.get(session.id);
    const { error } = await client.from('ride_sessions').upsert({
      id: session.id, user_id: userId, title: session.title, district_names: session.districtNames,
      started_at: new Date(session.startedAt).toISOString(), ended_at: new Date(session.endedAt).toISOString(),
      duration_seconds: session.durationSeconds, distance_meters: session.distanceMeters, new_distance_meters: session.newDistanceMeters,
    }, { onConflict: 'id' });
    if (error) throw syncError(`Could not upload ride “${session.title}”`, error);
    changedCloudData = true;
    if (cloudSession && samePoints(session.points, cloudSession.points)) continue;
    const { error: removedPointsError } = await client.from('ride_session_points').delete().eq('session_id', session.id);
    if (removedPointsError) throw syncError(`Could not replace GPS points for “${session.title}”`, removedPointsError);
    for (let index = 0; index < session.points.length; index += POINT_BATCH_SIZE) {
      const points = session.points.slice(index, index + POINT_BATCH_SIZE).map((point, offset) => ({
        session_id: session.id, user_id: userId, sequence: index + offset, lat: point.lat, lng: point.lng, accuracy: point.accuracy,
        recorded_at: new Date(point.timestamp).toISOString(), speed: point.speed ?? null, bearing: point.bearing ?? null,
      }));
      const { error: pointsError } = await client.from('ride_session_points').insert(points);
      if (pointsError) throw syncError(`Could not upload GPS points for “${session.title}”`, pointsError);
    }
  }
  if (changedCloudData) {
    onProgress?.({ label: 'Loading your account progress…' });
    const [reloadedCloudDiscoveries, reloadedCloudSessions] = await Promise.all([
      loadCloudDiscoveries(),
      client.from('ride_sessions').select('*, ride_session_points(*)').eq('user_id', userId).is('deleted_at', null).order('started_at', { ascending: false }),
    ]);
    if (reloadedCloudSessions.error) throw syncError('Could not reload cloud rides', reloadedCloudSessions.error);
    cloudDiscoveries = reloadedCloudDiscoveries;
    cloudSessions = reloadedCloudSessions.data ?? [];
  }
  const mergedDiscoveries = new Map<string, DiscoveredSegment>(discoveries.map(item => [item.id, item]));
  cloudDiscoveries.forEach((row: any) => mergedDiscoveries.set(row.segment_id, {
    id: row.segment_id, regionId: row.region_id ?? undefined, regionName: row.region_name ?? undefined, roadType: row.road_type,
    geometry: row.geometry, lengthMeters: row.length_meters, discoveredAt: new Date(row.discovered_at).valueOf(),
  }));
  const mergedSessions = new Map<string, RideSession>(sessions.map(item => [item.id, item]));
  cloudSessions.forEach((row: any) => {
    const cloudSession = toSession(row);
    const localSession = mergedSessions.get(row.id);
    // Thumbnails are a local rendering cache, not account data. Retain a valid
    // local one when the synced route has not changed.
    if (localSession && samePoints(localSession.points, cloudSession.points)) {
      cloudSession.thumbnail = localSession.thumbnail;
      cloudSession.thumbnailStyleVersion = localSession.thumbnailStyleVersion;
    }
    mergedSessions.set(row.id, cloudSession);
  });
  // Local GPS discoveries can arrive while a network request is in flight.
  // Keep them in the cache so the next automatic pass can upload them.
  (await loadDiscoveredSegments()).forEach(item => {
    if (!mergedDiscoveries.has(item.id)) mergedDiscoveries.set(item.id, item);
  });
  const initialSessionsById = new Map(sessions.map(item => [item.id, item]));
  (await loadSessions()).forEach(item => {
    const initial = initialSessionsById.get(item.id);
    if (!initial || !sameSessionDetails(initial, item) || !samePoints(initial.points, item.points)) mergedSessions.set(item.id, item);
  });
  const syncedDiscoveries = [...mergedDiscoveries.values()];
  const syncedSessions = [...mergedSessions.values()];
  onProgress?.({ label: 'Updating this device…' });
  await Promise.all([replaceDiscoveredSegments(syncedDiscoveries), replaceSessions(syncedSessions)]);
  return { discoveries: syncedDiscoveries, sessions: syncedSessions };
}

let activeSync: Promise<Awaited<ReturnType<typeof syncAccountProgress>>> | null = null;

/** Serialize manual and automatic syncs so neither replaces the other's cache. */
export function runAccountSync(userId: string, onProgress?: (progress: SyncProgress) => void) {
  if (activeSync) return activeSync;
  const task = syncAccountProgress(userId, onProgress).then(result => {
    const completedAt = new Date().toISOString();
    localStorage.setItem('roam:last-account-sync-at', completedAt);
    window.dispatchEvent(new CustomEvent('roam:account-sync-complete', { detail: { ...result, completedAt } }));
    return result;
  });
  activeSync = task;
  void task.finally(() => { if (activeSync === task) activeSync = null; }).catch(() => {});
  return task;
}
