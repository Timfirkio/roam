import { lookupAreas } from './area-client';
import type { AreaRecord } from './area-types';
import type { DiscoveredSegment } from './discovery';

type Sample = { coordinate: [number, number]; areas: AreaRecord[] | null };

function midpoint(segment: DiscoveredSegment): [number, number] {
  const coordinates = segment.geometry.coordinates;
  return coordinates[Math.floor(coordinates.length / 2)];
}

/** Sample the ride at bounded intervals, then assign its short road chunks to
 * their nearest API lookup. Each lookup includes all enclosing area levels. */
export async function lookupSessionRegions(segments: DiscoveredSegment[], signal?: AbortSignal) {
  const maximumSamples = 120;
  const count = Math.min(maximumSamples, segments.length);
  const samples: Sample[] = Array.from({ length: count }, (_, index) => ({
    coordinate: midpoint(segments[count === 1 ? 0 : Math.round(index * (segments.length - 1) / (count - 1))]),
    areas: null,
  }));
  let failed = 0;
  // Bound concurrent requests so opening a long ride does not flood the area API.
  for (let start = 0; start < samples.length; start += 8) {
    await Promise.all(samples.slice(start, start + 8).map(async sample => {
      try { sample.areas = (await lookupAreas(sample.coordinate[0], sample.coordinate[1], signal)).areas; }
      catch (error) { if (signal?.aborted) throw error; failed++; }
    }));
  }
  if (signal?.aborted) throw new DOMException('Region lookup cancelled', 'AbortError');
  const areasBySegment = new Map<string, AreaRecord[]>();
  for (const segment of segments) {
    const [lng, lat] = midpoint(segment);
    let closest: Sample | undefined;
    let bestDistance = Infinity;
    for (const sample of samples) {
      const longitudeScale = Math.cos(lat * Math.PI / 180);
      const distance = Math.hypot((sample.coordinate[0] - lng) * longitudeScale, sample.coordinate[1] - lat);
      if (distance < bestDistance) { bestDistance = distance; closest = sample; }
    }
    if (closest?.areas) areasBySegment.set(segment.id, closest.areas);
  }
  return { areasBySegment, failed, sampled: samples.length };
}
