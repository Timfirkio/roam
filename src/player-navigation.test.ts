import { describe, expect, it } from 'vitest';
import { bearingDegrees, nextNavigationState } from './player-navigation';

describe('player navigation state', () => {
  it('infers a northbound heading from consecutive GPS fixes', () => {
    expect(bearingDegrees({ lng: 18.0, lat: 59.0 }, { lng: 18.0, lat: 59.001 })).toBeCloseTo(0, 3);
  });
  it('keeps the arrow visible for a short stationary pause, then falls back to a dot', () => {
    const moving = nextNavigationState(null, { lng: 18.0, lat: 59.0, heading: 90, speed: 1.2, timestamp: 1_000 });
    expect(moving.isMoving).toBe(true);
    expect(nextNavigationState(moving, { ...moving, heading: null, speed: 0, timestamp: 8_500 }).isMoving).toBe(true);
    expect(nextNavigationState(moving, { ...moving, heading: null, speed: 0, timestamp: 9_100 }).isMoving).toBe(false);
  });
});
