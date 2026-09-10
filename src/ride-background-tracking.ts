import { registerPlugin } from '@capacitor/core';

export type RideTrackingPoint = {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
  speed?: number | null;
  bearing?: number | null;
};

export interface RideTrackingPlugin {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Atomically returns fixes collected while the WebView was asleep. */
  drainPoints(): Promise<{ points: RideTrackingPoint[] }>;
  /** Retains the complete raw track for the most recently recorded ride. */
  getRecordedRoute(): Promise<{ points: RideTrackingPoint[] }>;
  shareGpx(options: { contents: string; fileName: string }): Promise<void>;
  getState(): Promise<{ active: boolean; startedAt: number | null }>;
}
export const RideTracking = registerPlugin<RideTrackingPlugin>('RideTracking');
