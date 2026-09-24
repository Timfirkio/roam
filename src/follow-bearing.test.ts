import { describe, expect, it } from 'vitest';
import { FollowBearing, shortestTurn } from './follow-bearing';

describe('follow bearing', () => {
  it('takes the short path across north', () => {
    expect(shortestTurn(350, 10)).toBe(20);
    expect(shortestTurn(10, 350)).toBe(-20);
  });

  it('predicts a mounted phone turn and corrects toward GPS', () => {
    const follow = new FollowBearing();
    follow.gps(350, 6, true, 1_000);
    expect(follow.sensor(20, 15, 0, 1_050)).toBe(false);
    expect(follow.sensor(28, 15, 0, 1_100)).toBe(true);
    expect(follow.bearing).toBe(358);
    follow.gps(10, 6, true, 1_200);
    expect(follow.bearing).toBeCloseTo(365.8);
  });

  it('ignores handling, low speed and stale GPS', () => {
    const follow = new FollowBearing();
    follow.gps(90, 5, true, 1_000);
    follow.sensor(90, 10, 0, 1_050);
    expect(follow.sensor(100, 35, 0, 1_100)).toBe(false);
    follow.gps(90, 0, false, 1_200);
    expect(follow.sensor(105, 35, 0, 1_250)).toBe(false);
    follow.gps(90, 5, true, 1_300);
    expect(follow.sensor(110, 35, 0, 5_500)).toBe(false);
  });
});
