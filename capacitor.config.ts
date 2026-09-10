import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.roam.exploration',
  appName: 'Roam',
  webDir: 'dist',
  plugins: {
    Geolocation: {
      // Android uses this to avoid receiving a burst of redundant GPS fixes.
      minimumUpdateInterval: 5000,
    },
  },
};

export default config;
