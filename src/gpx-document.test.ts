import { expect, it } from 'vitest';
import { gpxDocument } from './gpx-document';

it('exports every point of a long ride in timestamp order', () => {
  const points = Array.from({ length: 1_501 }, (_, index) => ({
    lat: 59 + index / 100_000, lng: 18, accuracy: 5, timestamp: 1_000 + index * 1_000,
  }));
  const gpx = gpxDocument([...points].reverse());

  expect(gpx.match(/<trkpt /g)).toHaveLength(1_501);
  expect(gpx.indexOf(new Date(points[0].timestamp).toISOString())).toBeLessThan(gpx.indexOf(new Date(points.at(-1)!.timestamp).toISOString()));
});
