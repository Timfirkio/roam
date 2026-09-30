import type { Map } from 'maplibre-gl';

/** Reveal only after the configured style and its visible tiles have painted. */
export function onStyledMapIdle(map: Map, reveal: () => void): () => void {
  let active = true;
  const onIdle = () => {
    if (!active || !map.isStyleLoaded() || !map.areTilesLoaded()) return;
    map.off('idle', onIdle);
    // Let the completed map frame reach the screen before removing its cover.
    requestAnimationFrame(() => { if (active) reveal(); });
  };
  map.on('idle', onIdle);
  // Handle a map that became idle between configuration and subscription.
  if (map.isStyleLoaded() && map.areTilesLoaded() && !map.isMoving()) map.triggerRepaint();
  return () => { active = false; map.off('idle', onIdle); };
}
