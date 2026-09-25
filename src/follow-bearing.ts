export function shortestTurn(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

const SENSOR_DEAD_ZONE_DEGREES = 12;
const SHARP_TURN_START_DEGREES = 20;
const SHARP_TURN_FULL_DEGREES = 45;
const MAX_SENSOR_LEAD_DEGREES = 32;

/** GPS owns the travel direction. Device rotation only predicts turns between fixes. */
export class FollowBearing {
  private target: number | null = null;
  private gpsHeading: number | null = null;
  private sensorHeading: number | null = null;
  private sensorAnchorHeading: number | null = null;
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
      this.gpsHeading = this.gpsHeading === null ? heading : this.gpsHeading + shortestTurn(this.gpsHeading, heading) * 0.8;
      this.target = this.gpsHeading;
      this.sensorAnchorHeading = this.sensorHeading;
    } else if (!moving) {
      this.gpsHeading = null;
      this.sensorAnchorHeading = null;
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
    if (!this.moving || this.speed < 2.5 || this.gpsHeading === null || time - this.gpsTime > 4_000) return false;
    if (!stableMount || elapsed <= 0 || elapsed > 500 || Math.abs(turn) > Math.max(2, elapsed * 0.18)) {
      this.sensorAnchorHeading = heading;
      return false;
    }
    if (this.sensorAnchorHeading === null) {
      this.sensorAnchorHeading = heading;
      return false;
    }
    const sensorTurn = shortestTurn(this.sensorAnchorHeading, heading);
    const turnMagnitude = Math.abs(sensorTurn);
    const sharpTurnWeight = Math.min(1, Math.max(0, (turnMagnitude - SHARP_TURN_START_DEGREES) / (SHARP_TURN_FULL_DEGREES - SHARP_TURN_START_DEGREES)));
    const sensorWeight = 0.18 + sharpTurnWeight * 0.42;
    const lead = Math.sign(sensorTurn) * Math.min(MAX_SENSOR_LEAD_DEGREES, Math.max(0, turnMagnitude - SENSOR_DEAD_ZONE_DEGREES) * sensorWeight);
    const nextTarget = this.gpsHeading + lead;
    if (this.target !== null && Math.abs(shortestTurn(this.target, nextTarget)) < 1) return false;
    this.target = nextTarget;
    return true;
  }
}
