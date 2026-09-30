import type { Map } from 'maplibre-gl';
import { areaTileUrlTemplate } from './area-client';
import { boundaryPaintAtZoom, mapBoundaryLevel } from './map-boundary-level';

export const SESSION_ROUTE_COLOR = '#d59c67';

export function finishMarkerImage() {
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
  context.strokeStyle = SESSION_ROUTE_COLOR; context.lineWidth = 3;
  context.beginPath(); context.arc(24, 24, 17, 0, Math.PI * 2); context.stroke();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** Match the Map tab's region outline tier and paint at each zoom level. */
export function addSessionBoundaries(map: Map) {
  if (import.meta.env.VITE_AREA_CATALOG === 'false') return;
  map.addSource('session-boundaries', { type: 'vector', tiles: [areaTileUrlTemplate()], minzoom: 0, maxzoom: 22 });
  const level = mapBoundaryLevel(map.getZoom());
  const paint = boundaryPaintAtZoom(level, map.getZoom());
  map.addLayer({ id: 'session-boundaries-line', type: 'line', source: 'session-boundaries', 'source-layer': 'boundaries', layout: { 'line-cap': 'butt', 'line-join': 'miter' }, filter: level === 9 ? ['==', ['to-number', ['get', 'display_level'], ['to-number', ['get', 'admin_level'], 0]], 9] : ['==', ['to-number', ['get', 'admin_level'], 0], level], paint: { 'line-color': SESSION_ROUTE_COLOR, 'line-opacity': paint.opacity, 'line-width': paint.width } } as any);
  map.on('zoomend', () => {
    const nextLevel = mapBoundaryLevel(map.getZoom());
    const nextPaint = boundaryPaintAtZoom(nextLevel, map.getZoom());
    map.setFilter('session-boundaries-line', nextLevel === 9 ? ['==', ['to-number', ['get', 'display_level'], ['to-number', ['get', 'admin_level'], 0]], 9] : ['==', ['to-number', ['get', 'admin_level'], 0], nextLevel]);
    map.setPaintProperty('session-boundaries-line', 'line-opacity', nextPaint.opacity);
    map.setPaintProperty('session-boundaries-line', 'line-width', nextPaint.width);
  });
}
