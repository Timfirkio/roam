import maplibregl from 'maplibre-gl';
import type { SessionPoint } from './session-store';

const THUMBNAIL_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const WIDTH = 720;
const HEIGHT = 360;

function usableCoordinates(points: SessionPoint[]) {
  return points.filter(point => Number.isFinite(point.lng) && Number.isFinite(point.lat) && Math.abs(point.lng) <= 180 && Math.abs(point.lat) <= 90)
    .map(point => [point.lng, point.lat] as [number, number]);
}

/** Generates exactly one lightweight, non-interactive map image at a time. */
export async function generateSessionThumbnail(points: SessionPoint[]): Promise<Blob | null> {
  const coordinates = usableCoordinates(points);
  if (coordinates.length < 2 || typeof document === 'undefined') return null;
  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:-10000px;top:0;width:${WIDTH}px;height:${HEIGHT}px;pointer-events:none;opacity:0;`;
  document.body.appendChild(container);
  const mapRef: { current: maplibregl.Map | null } = { current: null };
  try {
    const image = await new Promise<Blob>((resolve, reject) => {
      let settled = false;
      const finish = (result: Blob | Error) => {
        if (settled) return;
        settled = true;
        result instanceof Error ? reject(result) : resolve(result);
      };
      const timeout = window.setTimeout(() => finish(new Error('Session thumbnail timed out')), 15_000);
      mapRef.current = new maplibregl.Map({
        container,
        style: THUMBNAIL_STYLE,
        center: coordinates[0],
        zoom: 13,
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
        canvasContextAttributes: { antialias: false, preserveDrawingBuffer: true, powerPreference: 'low-power' },
      });
      const map = mapRef.current;
      map.once('error', event => { if (!settled) finish(event.error instanceof Error ? event.error : new Error('Session thumbnail map failed')); });
      map.once('load', () => {
        if (!map) return;
        map.addSource('session-route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } } });
        map.addLayer({ id: 'session-route-outline', type: 'line', source: 'session-route', paint: { 'line-color': '#071615', 'line-width': 8, 'line-opacity': .8 } });
        map.addLayer({ id: 'session-route-line', type: 'line', source: 'session-route', paint: { 'line-color': '#2bb8b0', 'line-width': 5, 'line-opacity': .98 } });
        const bounds = coordinates.reduce((result, coordinate) => result.extend(coordinate), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
        map.fitBounds(bounds, { padding: 48, duration: 0, maxZoom: 15 });
        map.once('idle', () => window.requestAnimationFrame(() => {
          map?.getCanvas().toBlob(blob => { window.clearTimeout(timeout); finish(blob ?? new Error('Could not encode session thumbnail')); }, 'image/webp', .74);
        }));
      });
    });
    return image;
  } catch {
    return null;
  } finally {
    mapRef.current?.remove();
    container.remove();
  }
}
