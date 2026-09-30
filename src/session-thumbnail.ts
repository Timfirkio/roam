import * as maplibregl from 'maplibre-gl';
import type { SessionPoint } from './session-store';
import { applyRoamBaseStyle, ROAM_MAP_STYLE } from './roam-map-style';
import { installNetworkSource, NETWORK_SOURCE } from './network-source';
import { NETWORK_MIN_ZOOM } from './network-tiles';
import { addSessionBoundaries, finishMarkerImage, SESSION_ROUTE_COLOR } from './session-map-overlays';
import { PREVIEW_HEIGHT, PREVIEW_PADDING, PREVIEW_WIDTH, sessionCoordinates, smoothSessionCoordinates } from './session-preview-geometry';

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
      let fallbackCapture: number | undefined;
      const finish = (result: Blob | Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        window.clearTimeout(fallbackCapture);
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
        addSessionBoundaries(map);
        map.addSource('session-route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } } });
        map.addLayer({ id: 'session-route-outline', type: 'line', source: 'session-route', paint: { 'line-color': '#071615', 'line-width': 9, 'line-opacity': .8 } });
        map.addLayer({ id: 'session-route-line', type: 'line', source: 'session-route', paint: { 'line-color': SESSION_ROUTE_COLOR, 'line-width': 6, 'line-opacity': .98 } });
        map.addSource('session-route-markers', { type: 'geojson', data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: coordinates[0] } }, { type: 'Feature', properties: { kind: 'finish' }, geometry: { type: 'Point', coordinates: coordinates[coordinates.length - 1] } }] } });
        map.addLayer({ id: 'session-route-start', type: 'circle', source: 'session-route-markers', filter: ['==', ['get', 'kind'], 'start'], paint: { 'circle-radius': 8.5, 'circle-color': '#effffd', 'circle-stroke-color': SESSION_ROUTE_COLOR, 'circle-stroke-width': 3 } });
        map.addImage('session-finish-marker', finishMarkerImage());
        map.addLayer({ id: 'session-route-finish', type: 'symbol', source: 'session-route-markers', filter: ['==', ['get', 'kind'], 'finish'], layout: { 'icon-image': 'session-finish-marker', 'icon-size': 1, 'icon-allow-overlap': true } });
        const bounds = coordinates.reduce((result, coordinate) => result.extend(coordinate), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
        map.fitBounds(bounds, { padding: PREVIEW_PADDING, duration: 0, maxZoom: 15 });
        let captured = false;
        const capture = () => {
          if (captured || settled || signal?.aborted) return;
          captured = true;
          map.getCanvas().toBlob(blob => finish(blob ?? new Error('Could not encode session thumbnail')), 'image/webp', .82);
        };
        map.once('idle', capture);
        // A slow or broken tile must not hold the whole thumbnail queue hostage.
        fallbackCapture = window.setTimeout(capture, 8_000);
      });
    });
    return image;
  } catch (error) {
    if (!signal?.aborted) console.warn('Session thumbnail generation failed:', error);
    return null;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    mapRef.current?.remove();
    removeNetworkProtocol();
    container.remove();
  }
}
