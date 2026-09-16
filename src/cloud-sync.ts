import type { DiscoveredSegment, RoadType } from './discovery';
import { loadDiscoveredSegments, replaceDiscoveredSegments } from './discovery-store';
import { loadSessions, replaceSessions, type RideSession, type SessionPoint } from './session-store';
import { requireSupabase } from './supabase';

const POINT_BATCH_SIZE = 250;
const DISCOVERY_BATCH_SIZE = 250;

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

/** Upload local progress, then replace the local cache with the account-wide union. */
export async function syncAccountProgress(userId: string) {
  const client = requireSupabase();
  const [discoveries, sessions] = await Promise.all([loadDiscoveredSegments(), loadSessions()]);
  for (let index = 0; index < discoveries.length; index += DISCOVERY_BATCH_SIZE) {
    const { error } = await client.from('discoveries').upsert(discoveries.slice(index, index + DISCOVERY_BATCH_SIZE).map(segment => ({
      user_id: userId, segment_id: segment.id, region_id: segment.regionId ?? null, region_name: segment.regionName ?? null,
      road_type: normalizeRoadType(segment.roadType), geometry: segment.geometry, length_meters: segment.lengthMeters, discovered_at: new Date(segment.discoveredAt).toISOString(),
    })), { onConflict: 'user_id,segment_id', ignoreDuplicates: true });
    if (error) throw syncError(`Could not upload discoveries batch ${index / DISCOVERY_BATCH_SIZE + 1}`, error);
  }
  for (const session of sessions) {
    const { error } = await client.from('ride_sessions').upsert({
      id: session.id, user_id: userId, title: session.title, district_names: session.districtNames,
      started_at: new Date(session.startedAt).toISOString(), ended_at: new Date(session.endedAt).toISOString(),
      duration_seconds: session.durationSeconds, distance_meters: session.distanceMeters, new_distance_meters: session.newDistanceMeters,
    }, { onConflict: 'id' });
    if (error) throw syncError(`Could not upload ride “${session.title}”`, error);
    if (!session.points.length) continue;
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
  const [{ data: cloudDiscoveries, error: discoveriesError }, { data: cloudSessions, error: sessionsError }] = await Promise.all([
    client.from('discoveries').select('*').order('discovered_at'),
    client.from('ride_sessions').select('*, ride_session_points(*)').is('deleted_at', null).order('started_at', { ascending: false }),
  ]);
  if (discoveriesError) throw syncError('Could not load cloud discoveries', discoveriesError);
  if (sessionsError) throw syncError('Could not load cloud rides', sessionsError);
  const mergedDiscoveries = new Map<string, DiscoveredSegment>(discoveries.map(item => [item.id, item]));
  cloudDiscoveries.forEach((row: any) => mergedDiscoveries.set(row.segment_id, {
    id: row.segment_id, regionId: row.region_id ?? undefined, regionName: row.region_name ?? undefined, roadType: row.road_type,
    geometry: row.geometry, lengthMeters: row.length_meters, discoveredAt: new Date(row.discovered_at).valueOf(),
  }));
  const mergedSessions = new Map<string, RideSession>(sessions.map(item => [item.id, item]));
  cloudSessions.forEach((row: any) => mergedSessions.set(row.id, toSession(row)));
  await Promise.all([replaceDiscoveredSegments([...mergedDiscoveries.values()]), replaceSessions([...mergedSessions.values()])]);
  return { discoveries: [...mergedDiscoveries.values()], sessions: [...mergedSessions.values()] };
}
