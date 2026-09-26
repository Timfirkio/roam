import { useEffect, useState } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';

export function useAppVisible() {
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState !== 'hidden');
  const [nativeActive, setNativeActive] = useState(true);
  useEffect(() => {
    const onVisibility = () => setDocumentVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    onVisibility();
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let disposed = false;
    let receivedEvent = false;
    let listener: PluginListenerHandle | undefined;
    void App.addListener('appStateChange', ({ isActive }) => {
      receivedEvent = true;
      if (!disposed) setNativeActive(isActive);
    }).then(handle => {
      if (disposed) void handle.remove();
      else listener = handle;
    }).catch(error => console.warn('Could not observe app visibility:', error));
    void App.getState().then(({ isActive }) => {
      if (!disposed && !receivedEvent) setNativeActive(isActive);
    }).catch(error => console.warn('Could not read app visibility:', error));
    return () => { disposed = true; void listener?.remove(); };
  }, []);
  return documentVisible && nativeActive;
}
