import * as maplibregl from 'maplibre-gl';
import type { SessionPoint } from './session-store';
import { applyRoamBaseStyle, ROAM_MAP_STYLE } from './roam-map-style';
import { installNetworkSource, NETWORK_SOURCE } from './network-source';
import { NETWORK_MIN_ZOOM } from './network-tiles';
import { areaTileUrlTemplate } from './area-client';
import { boundaryPaintAtZoom, mapBoundaryLevel } from './map-boundary-level';
import { PREVIEW_HEIGHT, PREVIEW_PADDING, PREVIEW_WIDTH, sessionCoordinates, smoothSessionCoordinates } from './session-preview-geometry';

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
export async function generateSessionThumbnail(points: SessionPoint[], signal?: AbortSignal): Promise<Blob | null> {
  if (signal?.aborted) return null;
  const coordinates = smoothSessionCoordinates(sessionCoordinates(points));
  if (coordinates.length < 2 || typeof document === 'undefined') return null;
  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:-10000px;top:0;width:${PREVIEW_WIDTH}px;height:${PREVIEW_HEIGHT}px;pointer-events:none;opacity:0;`;
  document.body.appendChild(container);
  const mapRef: { current: maplibregl.Map | null } = { current: null };
  let removeNetworkProtocol = () => {};
  let onAbort = () => {};
  try {
    const image = await new Promise<Blob>((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => finish(new Error('Session thumbnail timed out')), 15_000);
      const finish = (result: Blob | Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        result instanceof Error ? reject(result) : resolve(result);
      };
      onAbort = () => finish(new Error('Session thumbnail cancelled'));
      signal?.addEventListener('abort', onAbort, { once: true });
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
      // Individual network tiles can fail while the map and route still render.
      map.once('load', () => {
        if (!map) return;
        removeNetworkProtocol = installNetworkSource(map);
        applyRoamBaseStyle(map);
        const basePathLayer = map.getStyle().layers?.find(layer => layer.id === 'roam-bikeable-paths');
        if (basePathLayer?.type === 'line') {
          map.addLayer({ ...basePathLayer, id: 'roam-bikeable-paths-detail', source: NETWORK_SOURCE, minzoom: NETWORK_MIN_ZOOM } as any, 'roam-bikeable-paths');
          map.setLayerZoomRange('roam-bikeable-paths', 6, NETWORK_MIN_ZOOM);
        }
        if (import.meta.env.VITE_AREA_CATALOG !== 'false') {
          map.addSource('session-boundaries', { type: 'vector', tiles: [areaTileUrlTemplate()], minzoom: 0, maxzoom: 22 });
          const level = mapBoundaryLevel(map.getZoom());
          const paint = boundaryPaintAtZoom(level, map.getZoom());
          map.addLayer({ id: 'session-boundaries-line', type: 'line', source: 'session-boundaries', 'source-layer': 'boundaries', filter: level === 9 ? ['==', ['to-number', ['get', 'display_level'], ['to-number', ['get', 'admin_level'], 0]], 9] : ['==', ['to-number', ['get', 'admin_level'], 0], level], paint: { 'line-color': '#d59c67', 'line-opacity': paint.opacity, 'line-width': paint.width } } as any);
          map.on('zoomend', () => {
            const nextLevel = mapBoundaryLevel(map.getZoom());
            const nextPaint = boundaryPaintAtZoom(nextLevel, map.getZoom());
            map.setFilter('session-boundaries-line', nextLevel === 9 ? ['==', ['to-number', ['get', 'display_level'], ['to-number', ['get', 'admin_level'], 0]], 9] : ['==', ['to-number', ['get', 'admin_level'], 0], nextLevel]);
            map.setPaintProperty('session-boundaries-line', 'line-opacity', nextPaint.opacity);
            map.setPaintProperty('session-boundaries-line', 'line-width', nextPaint.width);
          });
        }
        map.addSource('session-route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } } });
        map.addLayer({ id: 'session-route-outline', type: 'line', source: 'session-route', paint: { 'line-color': '#071615', 'line-width': 9, 'line-opacity': .8 } });
        map.addLayer({ id: 'session-route-line', type: 'line', source: 'session-route', paint: { 'line-color': '#2bb8b0', 'line-width': 6, 'line-opacity': .98 } });
        map.addSource('session-route-markers', { type: 'geojson', data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: coordinates[0] } }, { type: 'Feature', properties: { kind: 'finish' }, geometry: { type: 'Point', coordinates: coordinates[coordinates.length - 1] } }] } });
        map.addLayer({ id: 'session-route-start', type: 'circle', source: 'session-route-markers', filter: ['==', ['get', 'kind'], 'start'], paint: { 'circle-radius': 8.5, 'circle-color': '#effffd', 'circle-stroke-color': '#2bb8b0', 'circle-stroke-width': 3 } });
        map.addImage('session-finish-marker', finishMarkerImage());
        map.addLayer({ id: 'session-route-finish', type: 'symbol', source: 'session-route-markers', filter: ['==', ['get', 'kind'], 'finish'], layout: { 'icon-image': 'session-finish-marker', 'icon-size': 1, 'icon-allow-overlap': true } });
        const bounds = coordinates.reduce((result, coordinate) => result.extend(coordinate), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
        map.fitBounds(bounds, { padding: PREVIEW_PADDING, duration: 0, maxZoom: 15 });
        map.once('idle', () => window.requestAnimationFrame(() => {
          map?.getCanvas().toBlob(blob => finish(blob ?? new Error('Could not encode session thumbnail')), 'image/webp', .88);
        }));
      });
    });
    return image;
  } catch {
    return null;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    mapRef.current?.remove();
    removeNetworkProtocol();
    container.remove();
  }
}
