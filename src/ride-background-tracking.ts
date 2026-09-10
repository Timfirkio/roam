import { registerPlugin } from '@capacitor/core';
export interface RideTrackingPlugin { start(): Promise<void>; stop(): Promise<void>; }
export const RideTracking = registerPlugin<RideTrackingPlugin>('RideTracking');
