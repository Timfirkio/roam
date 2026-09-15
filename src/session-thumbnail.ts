import maplibregl from 'maplibre-gl';
import type { SessionPoint } from './session-store';
import { applyRoamBaseStyle, ROAM_MAP_STYLE } from './roam-map-style';
import { installNetworkSource, NETWORK_SOURCE } from './network-source';
import { NETWORK_MIN_ZOOM } from './network-tiles';

const WIDTH = 720;
const HEIGHT = 360;

function usableCoordinates(points: SessionPoint[]) {
  return points.filter(point => Number.isFinite(point.lng) && Number.isFinite(point.lat) && Math.abs(point.lng) <= 180 && Math.abs(point.lat) <= 90)
    .map(point => [point.lng, point.lat] as [number, number]);
}

function smoothCoordinates(coordinates: [number, number][]) {
  const longitudeScale = Math.cos(coordinates.reduce((total, [, lat]) => total + lat, 0) / coordinates.length * Math.PI / 180);
  return coordinates.map((coordinate, index) => {
    if (index === 0 || index === coordinates.length - 1) return coordinate;
    const previous = coordinates[index - 1];
    const next = coordinates[index + 1];
    return [(previous[0] + coordinate[0] * 2 + next[0]) / 4, (previous[1] + coordinate[1] * 2 + next[1]) / 4] as [number, number];
  }).filter((coordinate, index, all) => {
    if (index === 0 || index === all.length - 1) return true;
    const previous = all[index - 1];
    return Math.hypot((coordinate[0] - previous[0]) * longitudeScale, coordinate[1] - previous[1]) > 0.000035;
  });
}

function finishMarkerImage() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 48;
  const context = canvas.getContext('2d')!;
  context.save(); context.beginPath(); context.arc(24, 24, 17, 0, Math.PI * 2); context.clip();
  const cell = 12;
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
    context.fillStyle = (row + column) % 2 === 0 ? '#effffd' : '#0a0f10';
    context.fillRect(6 + column * cell, 6 + row * cell, cell, cell);
  }
  context.restore();
  context.strokeStyle = '#2bb8b0'; context.lineWidth = 3; context.beginPath(); context.arc(24, 24, 17, 0, Math.PI * 2); context.stroke();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** Generates exactly one lightweight, non-interactive map image at a time. */
export async function generateSessionThumbnail(points: SessionPoint[]): Promise<Blob | null> {
  const coordinates = smoothCoordinates(usableCoordinates(points));
  if (coordinates.length < 2 || typeof document === 'undefined') return null;
  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:-10000px;top:0;width:${WIDTH}px;height:${HEIGHT}px;pointer-events:none;opacity:0;`;
  document.body.appendChild(container);
  const mapRef: { current: maplibregl.Map | null } = { current: null };
  let removeNetworkProtocol = () => {};
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
        style: ROAM_MAP_STYLE,
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
        removeNetworkProtocol = installNetworkSource(map);
        applyRoamBaseStyle(map);
        const basePathLayer = map.getStyle().layers?.find(layer => layer.id === 'roam-bikeable-paths');
        if (basePathLayer?.type === 'line') {
          map.addLayer({ ...basePathLayer, id: 'roam-bikeable-paths-detail', source: NETWORK_SOURCE, minzoom: NETWORK_MIN_ZOOM } as any, 'roam-bikeable-paths');
          map.setLayerZoomRange('roam-bikeable-paths', 6, NETWORK_MIN_ZOOM);
        }
        map.addSource('session-route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } } });
        map.addLayer({ id: 'session-route-outline', type: 'line', source: 'session-route', paint: { 'line-color': '#071615', 'line-width': 9, 'line-opacity': .8 } });
        map.addLayer({ id: 'session-route-line', type: 'line', source: 'session-route', paint: { 'line-color': '#2bb8b0', 'line-width': 6, 'line-opacity': .98 } });
        map.addSource('session-route-markers', { type: 'geojson', data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: coordinates[0] } }, { type: 'Feature', properties: { kind: 'finish' }, geometry: { type: 'Point', coordinates: coordinates[coordinates.length - 1] } }] } });
        map.addLayer({ id: 'session-route-start', type: 'circle', source: 'session-route-markers', filter: ['==', ['get', 'kind'], 'start'], paint: { 'circle-radius': 7, 'circle-color': '#2bb8b0', 'circle-stroke-color': '#effffd', 'circle-stroke-width': 3 } });
        map.addImage('session-finish-marker', finishMarkerImage());
        map.addLayer({ id: 'session-route-finish', type: 'symbol', source: 'session-route-markers', filter: ['==', ['get', 'kind'], 'finish'], layout: { 'icon-image': 'session-finish-marker', 'icon-size': .72, 'icon-allow-overlap': true } });
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
    removeNetworkProtocol();
    container.remove();
  }
}
