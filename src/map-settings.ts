import { useEffect, useState } from 'react';

type MapSetting = 'region-boundaries' | '3d-view' | '3d-buildings' | '3d-terrain';

// Device-local display preferences work offline and do not require an account.
export function useMapSetting(setting: MapSetting) {
  const key = `roam:map-settings:${setting}`;
  const [value, setValue] = useState(() => {
    try { return localStorage.getItem(key) === 'true'; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, String(value)); }
    catch { /* Settings remain usable when local storage is unavailable. */ }
  }, [key, value]);
  return [value, setValue] as const;
}
