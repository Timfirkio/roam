export function shortestTurn(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

/** GPS owns the travel direction. Device rotation only predicts turns between fixes. */
export class FollowBearing {
  private target: number | null = null;
  private sensorHeading: number | null = null;
  private sensorPitch: number | null = null;
  private sensorRoll: number | null = null;
  private mountPitch: number | null = null;
  private mountRoll: number | null = null;
  private sensorTime = 0;
  private gpsTime = 0;
  private speed = 0;
  private moving = false;

  get bearing() { return this.target; }

  gps(heading: number | null, speed: number | null, moving: boolean, time: number) {
    this.speed = speed ?? 0;
    this.moving = moving;
    this.gpsTime = time;
    this.mountPitch = this.sensorPitch;
    this.mountRoll = this.sensorRoll;
    if (moving && heading !== null && Number.isFinite(heading)) {
      this.target = this.target === null ? heading : this.target + shortestTurn(this.target, heading) * 0.65;
    }
  }

  sensor(heading: number, pitch: number, roll: number, time: number) {
    if (![heading, pitch, roll, time].every(Number.isFinite)) return false;
    const elapsed = time - this.sensorTime;
    const turn = this.sensorHeading === null ? 0 : shortestTurn(this.sensorHeading, heading);
    if (this.mountPitch === null || this.mountRoll === null) {
      this.mountPitch = pitch;
      this.mountRoll = roll;
    }
    const stableMount = this.sensorPitch !== null && this.sensorRoll !== null
      && Math.abs(pitch - this.mountPitch) < 12 && Math.abs(roll - this.mountRoll) < 12;
    this.sensorHeading = heading;
    this.sensorPitch = pitch;
    this.sensorRoll = roll;
    this.sensorTime = time;
    if (!this.moving || this.speed < 2.5 || this.target === null || time - this.gpsTime > 4_000) return false;
    if (!stableMount || elapsed <= 0 || elapsed > 500 || Math.abs(turn) > Math.max(2, elapsed * 0.18)) return false;
    this.target += turn;
    return true;
  }
}
