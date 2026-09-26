import { useEffect, useState } from 'react';

type MapSetting = 'region-boundaries' | 'region-boundaries-v2' | '3d-view' | '3d-buildings' | '3d-terrain';

// Device-local display preferences work offline and do not require an account.
export function useMapSetting(setting: MapSetting, defaultValue = false) {
  const key = `roam:map-settings:${setting}`;
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? defaultValue : stored === 'true';
    }
    catch { return defaultValue; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, String(value)); }
    catch { /* Settings remain usable when local storage is unavailable. */ }
  }, [key, value]);
  return [value, setValue] as const;
}
