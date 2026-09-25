import { describe, expect, it } from 'vitest';
import { FollowBearing, shortestTurn } from './follow-bearing';

describe('follow bearing', () => {
  it('takes the short path across north', () => {
    expect(shortestTurn(350, 10)).toBe(20);
    expect(shortestTurn(10, 350)).toBe(-20);
  });

  it('ignores handlebar wobble and predicts a sharper turn between GPS fixes', () => {
    const follow = new FollowBearing();
    follow.gps(90, 6, true, 1_000);
    expect(follow.sensor(90, 15, 0, 1_050)).toBe(false);
    expect(follow.sensor(100, 15, 0, 1_150)).toBe(false);
    expect(follow.sensor(105, 15, 0, 1_250)).toBe(false);
    expect(follow.bearing).toBe(90);
    expect(follow.sensor(115, 15, 0, 1_350)).toBe(true);
    expect(follow.bearing).toBeLessThan(95);
    follow.sensor(125, 15, 0, 1_450);
    follow.sensor(140, 15, 0, 1_550);
    expect(follow.bearing).toBeGreaterThan(110);
    expect(follow.bearing).toBeLessThan(120);
    follow.gps(100, 6, true, 1_600);
    expect(follow.bearing).toBe(98);
    expect(follow.sensor(142, 15, 0, 1_650)).toBe(false);
    expect(follow.bearing).toBe(98);
  });

  it('follows GPS course through north without carrying sensor drift forward', () => {
    const follow = new FollowBearing();
    follow.gps(350, 6, true, 1_000);
    follow.sensor(350, 15, 0, 1_050);
    follow.sensor(360, 15, 0, 1_150);
    follow.sensor(370, 15, 0, 1_250);
    follow.sensor(380, 15, 0, 1_350);
    expect(follow.bearing).toBeGreaterThan(350);
    follow.gps(10, 6, true, 1_400);
    expect(follow.bearing).toBe(366);
    follow.gps(10, 6, true, 1_600);
    expect(follow.bearing).toBeCloseTo(369.2);
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
