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
    // With viewport-fit=cover, Capacitor passes system insets through to the
    // WebView as CSS variables instead of padding it. This keeps the map
    // edge-to-edge while letting controls avoid Android's protected areas.
    SystemBars: {
      insetsHandling: 'css',
      style: 'dark',
    },
  },
};

export default config;
