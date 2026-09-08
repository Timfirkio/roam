export type LocationFix = {
  lng: number;
  lat: number;
  heading: number | null;
  speed: number | null;
  timestamp: number;
};

export type NavigationState = LocationFix & { travelHeading: number | null; isMoving: boolean; lastMovingAt: number };

const MOVING_SPEED_METERS_PER_SECOND = 0.55;
const STATIONARY_GRACE_MS = 8_000;

export function distanceMeters(a: Pick<LocationFix, 'lng' | 'lat'>, b: Pick<LocationFix, 'lng' | 'lat'>) {
  const radians = Math.PI / 180;
  const deltaLat = (b.lat - a.lat) * radians;
  const deltaLng = (b.lng - a.lng) * radians;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const value = sinLat ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * sinLng ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function bearingDegrees(a: Pick<LocationFix, 'lng' | 'lat'>, b: Pick<LocationFix, 'lng' | 'lat'>) {
  const radians = Math.PI / 180;
  const deltaLng = (b.lng - a.lng) * radians;
  const y = Math.sin(deltaLng) * Math.cos(b.lat * radians);
  const x = Math.cos(a.lat * radians) * Math.sin(b.lat * radians) - Math.sin(a.lat * radians) * Math.cos(b.lat * radians) * Math.cos(deltaLng);
  return (Math.atan2(y, x) / radians + 360) % 360;
}

export function nextNavigationState(previous: NavigationState | null, fix: LocationFix): NavigationState {
  const elapsedSeconds = previous ? Math.max((fix.timestamp - previous.timestamp) / 1_000, 0.001) : 0;
  const inferredSpeed = previous ? distanceMeters(previous, fix) / elapsedSeconds : 0;
  const speed = Number.isFinite(fix.speed) ? fix.speed! : inferredSpeed;
  const movedEnoughToOrient = previous ? distanceMeters(previous, fix) >= 2 : false;
  const travelHeading = Number.isFinite(fix.heading)
    ? fix.heading
    : movedEnoughToOrient && previous ? bearingDegrees(previous, fix) : previous?.travelHeading ?? null;
  const movingNow = speed >= MOVING_SPEED_METERS_PER_SECOND && travelHeading !== null;
  const lastMovingAt = movingNow ? fix.timestamp : previous?.lastMovingAt ?? 0;
  return { ...fix, travelHeading, lastMovingAt, isMoving: movingNow || fix.timestamp - lastMovingAt < STATIONARY_GRACE_MS };
}
