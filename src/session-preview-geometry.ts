import type { SessionPoint } from './session-store';

export const PREVIEW_WIDTH = 1440;
export const PREVIEW_HEIGHT = 720;
export const PREVIEW_PADDING = 48;

export function sessionCoordinates(points: SessionPoint[]): [number, number][] {
  return points.filter(point => Number.isFinite(point.lng) && Number.isFinite(point.lat) && Math.abs(point.lng) <= 180 && Math.abs(point.lat) <= 85)
    .map(point => [point.lng, point.lat]);
}

export function smoothSessionCoordinates(coordinates: [number, number][]) {
  const longitudeScale = Math.cos(coordinates.reduce((total, [, lat]) => total + lat, 0) / coordinates.length * Math.PI / 180);
  return coordinates.map((coordinate, index) => {
    if (index === 0 || index === coordinates.length - 1) return coordinate;
    const previous = coordinates[index - 1];
    const next = coordinates[index + 1];
    return [(previous[0] + coordinate[0] * 2 + next[0]) / 4, (previous[1] + coordinate[1] * 2 + next[1]) / 4] as [number, number];
  }).filter((coordinate, index, all) => index === 0 || index === all.length - 1 || Math.hypot((coordinate[0] - all[index - 1][0]) * longitudeScale, coordinate[1] - all[index - 1][1]) > 0.000035);
}

function mercator([lng, lat]: [number, number]): [number, number] {
  const latitude = lat * Math.PI / 180;
  return [(lng + 180) / 360, (1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2];
}

/** Match MapLibre's north-up fitBounds camera for a 2:1 thumbnail. */
export function sessionPreviewGeometry(coordinates: [number, number][]) {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const coordinate of coordinates) {
    const [x, y] = mercator(coordinate);
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  const scale = Math.min((PREVIEW_WIDTH - 2 * PREVIEW_PADDING) / Math.max(right - left, 1e-12), (PREVIEW_HEIGHT - 2 * PREVIEW_PADDING) / Math.max(bottom - top, 1e-12), 512 * 2 ** 15);
  const centerX = (left + right) / 2, centerY = (top + bottom) / 2;
  const project = (coordinate: [number, number]) => {
    const [x, y] = mercator(coordinate);
    return [PREVIEW_WIDTH / 2 + (x - centerX) * scale, PREVIEW_HEIGHT / 2 + (y - centerY) * scale] as const;
  };
  return { project };
}

const previewDrawingCache = new WeakMap<SessionPoint[], ReturnType<typeof buildSessionPreviewDrawing>>();

function buildSessionPreviewDrawing(points: SessionPoint[]) {
  const coordinates = sessionCoordinates(points);
  if (coordinates.length < 2) return null;
  const smoothed = smoothSessionCoordinates(coordinates);
  const { project } = sessionPreviewGeometry(smoothed);
  return {
    routePath: smoothed.map((coordinate, index) => `${index === 0 ? 'M' : 'L'} ${project(coordinate).join(' ')}`).join(' '),
    start: project(smoothed[0]),
    end: project(smoothed[smoothed.length - 1]),
  };
}

/** Reuse the exact same SVG drawing from a session card on its detail page. */
export function sessionPreviewDrawing(points: SessionPoint[]) {
  if (previewDrawingCache.has(points)) return previewDrawingCache.get(points)!;
  const drawing = buildSessionPreviewDrawing(points);
  previewDrawingCache.set(points, drawing);
  return drawing;
}
