import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.roam.exploration',
  appName: 'Roam',
  webDir: 'dist',
  plugins: {
    Geolocation: {
      // A five-second fix is visibly too sparse on a bicycle. The native ride
      // service remains the source of truth while a session is active; this is
      // the lightweight live-map watch used outside of a recording.
      minimumUpdateInterval: 2000,
    },
  },
};

export default config;
