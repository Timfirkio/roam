import { useEffect, useRef, useState } from 'react';

type WakeLockStatus = 'active' | 'unsupported' | 'unavailable' | 'inactive';
type WakeLockSentinelLike = EventTarget & { release: () => Promise<void> };

export function useScreenWakeLock(enabled: boolean): WakeLockStatus {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const [status, setStatus] = useState<WakeLockStatus>('inactive');

  useEffect(() => {
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!enabled) {
      sentinelRef.current?.release().catch(() => {});
      sentinelRef.current = null;
      setStatus('inactive');
      return;
    }
    if (!wakeLock) {
      setStatus('unsupported');
      return;
    }

    let cancelled = false;
    const request = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        const sentinel = await wakeLock.request('screen');
        if (cancelled) { await sentinel.release(); return; }
        sentinelRef.current = sentinel;
        sentinel.addEventListener('release', () => { if (!cancelled) setStatus('unavailable'); }, { once: true });
        setStatus('active');
      } catch {
        if (!cancelled) setStatus('unavailable');
      }
    };
    const handleVisibilityChange = () => { if (document.visibilityState === 'visible') void request(); };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    void request();
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      sentinelRef.current?.release().catch(() => {});
      sentinelRef.current = null;
    };
  }, [enabled]);

  return status;
}
