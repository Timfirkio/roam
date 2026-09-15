import maplibregl from 'maplibre-gl';
import type { SessionPoint } from './session-store';

const THUMBNAIL_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
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

function styleThumbnailMap(map: maplibregl.Map) {
  map.setPaintProperty('background', 'background-color', '#0a0b0c');
  for (const layer of map.getStyle().layers ?? []) {
    const id = layer.id.toLowerCase();
    const sourceLayer = 'source-layer' in layer && typeof layer['source-layer'] === 'string' ? layer['source-layer'].toLowerCase() : '';
    const isRoad = id.includes('transportation') || sourceLayer === 'transportation';
    const isWater = id.includes('water') || sourceLayer === 'water';
    const isPark = /park|wood|forest|grass|meadow|cemetery|recreation|garden|landcover/.test(id) || /landcover|landuse/.test(sourceLayer);
    const isRestricted = /military|aeroway|airport|airfield/.test(id) || /military|aeroway/.test(sourceLayer);
    if (layer.type === 'symbol' || id.includes('building') || id.includes('boundary') || /rail/.test(id)) map.setLayoutProperty(layer.id, 'visibility', 'none');
    if (layer.type === 'fill' && isWater) { map.setPaintProperty(layer.id, 'fill-color', '#102331'); map.setPaintProperty(layer.id, 'fill-opacity', .92); }
    if (layer.type === 'fill' && isPark) { map.setPaintProperty(layer.id, 'fill-color', '#0e1b17'); map.setPaintProperty(layer.id, 'fill-opacity', .86); }
    if (layer.type === 'fill' && isRestricted) { map.setPaintProperty(layer.id, 'fill-color', '#241216'); map.setPaintProperty(layer.id, 'fill-opacity', .9); }
    if (isRoad && layer.type === 'line') {
      const isCycleway = /cycleway/.test(id);
      const isPath = /cycleway|footway|pedestrian|track|path|bridleway/.test(id);
      const isMajor = /motorway|trunk|primary/.test(id);
      map.setPaintProperty(layer.id, 'line-color', isCycleway ? '#2bb8b0' : isMajor ? '#46504d' : isPath ? '#72563d' : '#55615c');
      map.setPaintProperty(layer.id, 'line-opacity', isPath ? .34 : .46);
      map.setPaintProperty(layer.id, 'line-width', isMajor ? 4.5 : isPath ? 2.4 : 3);
      map.setLayoutProperty(layer.id, 'line-cap', 'round');
      map.setLayoutProperty(layer.id, 'line-join', 'round');
    }
  }
}

function finishMarkerImage() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 48;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#0a0f10'; context.beginPath(); context.arc(24, 24, 19, 0, Math.PI * 2); context.fill();
  context.strokeStyle = '#2bb8b0'; context.lineWidth = 3; context.stroke();
  context.fillStyle = '#effffd'; context.fillRect(18, 14, 4, 20); context.fillRect(22, 14, 10, 12);
  context.fillStyle = '#0a0f10'; context.fillRect(22, 14, 5, 6); context.fillRect(27, 20, 5, 6);
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
        styleThumbnailMap(map);
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
    container.remove();
  }
}
