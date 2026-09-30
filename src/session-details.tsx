import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { RideSession } from './session-store';
import type { DiscoveredSegment } from './discovery';
import { discoveryTimeline, ROAD_TYPES, regionDiscoveryShares } from './session-analytics';
import { sessionDetailEntry } from './session-detail-data';
import { formatDistance } from './distance-format';
import { sessionCoordinates, smoothSessionCoordinates } from './session-preview-geometry';
import { applyRoamBaseStyle, ROAM_MAP_STYLE } from './roam-map-style';
import { installNetworkSource } from './network-source';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog';
import { Button } from './components/ui/button';
import { ArrowLeft, ArrowsOutSimple, X } from '@phosphor-icons/react';

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = Math.floor(seconds % 60);
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}` : `${minutes}:${String(remaining).padStart(2, '0')}`;
}

function LiveSessionMap({ session }: { session: RideSession }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    const coordinates = smoothSessionCoordinates(sessionCoordinates(session.points));
    if (coordinates.length < 2) return;
    const map = new maplibregl.Map({ container: container.current, style: ROAM_MAP_STYLE, center: coordinates[0], zoom: 13 });
    let removeNetwork = () => {};
    map.once('load', () => {
      removeNetwork = installNetworkSource(map);
      applyRoamBaseStyle(map);
      map.addSource('session-route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } } });
      map.addLayer({ id: 'session-route-outline', type: 'line', source: 'session-route', paint: { 'line-color': '#071615', 'line-width': 9, 'line-opacity': .8 } });
      map.addLayer({ id: 'session-route-line', type: 'line', source: 'session-route', paint: { 'line-color': '#2bb8b0', 'line-width': 6, 'line-opacity': .98 } });
      map.addSource('session-endpoints', { type: 'geojson', data: { type: 'FeatureCollection', features: [
        { type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: coordinates[0] } },
        { type: 'Feature', properties: { kind: 'finish' }, geometry: { type: 'Point', coordinates: coordinates.at(-1)! } },
      ] } });
      map.addLayer({ id: 'session-start', type: 'circle', source: 'session-endpoints', filter: ['==', ['get', 'kind'], 'start'], paint: { 'circle-radius': 9, 'circle-color': '#effffd', 'circle-stroke-color': '#2bb8b0', 'circle-stroke-width': 3 } });
      map.addLayer({ id: 'session-finish', type: 'circle', source: 'session-endpoints', filter: ['==', ['get', 'kind'], 'finish'], paint: { 'circle-radius': 9, 'circle-color': '#0a0f10', 'circle-stroke-color': '#2bb8b0', 'circle-stroke-width': 3 } });
      const bounds = coordinates.reduce((result, coordinate) => result.extend(coordinate), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
      map.fitBounds(bounds, { padding: 48, duration: 0, maxZoom: 15 });
    });
    map.on('error', () => setError(true));
    return () => { map.remove(); removeNetwork(); };
  }, [session.id, session.points]);
  return <div className="session-live-map" ref={container} role="application" aria-label="Interactive session route map">{error && <span className="session-map-error">Some map tiles could not load.</span>}</div>;
}

function DiscoveryChart({ session, segments }: { session: RideSession; segments: DiscoveredSegment[] }) {
  const values = discoveryTimeline(session, segments);
  const maximum = Math.max(1, ...values);
  const points = values.map((value, index) => `${8 + index * 584 / (values.length - 1)},${160 - value / maximum * 120}`).join(' ');
  return <div className="session-chart-wrap"><svg viewBox="0 0 600 164" role="img" aria-label={`Cumulative new road discovery rose to ${formatDistance(values.at(-1) ?? 0)} over this ride`} preserveAspectRatio="none">
    {[0, 1, 2].map(index => <line key={index} x1="8" x2="592" y1={40 + index * 60} y2={40 + index * 60} stroke="var(--color-border-muted)" strokeDasharray="4 6" />)}
    <polygon points={`8,160 ${points} 592,160`} fill="var(--color-accent)" fillOpacity="0.12" />
    <polyline points={points} fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    <circle cx="592" cy={160 - (values.at(-1) ?? 0) / maximum * 120} r="4" fill="var(--color-accent)" />
  </svg><span className="session-chart-total">{formatDistance(session.newDistanceMeters)} new</span><div className="session-chart-axis"><span>Start</span><span>{formatDuration(session.durationSeconds)}</span></div></div>;
}

export function SessionInsights({ session, discoveries, preview, title }: { session: RideSession; discoveries: DiscoveredSegment[]; preview: ReactNode; title: string }) {
  const [mapOpen, setMapOpen] = useState(false);
  // A detail page is a snapshot: background cloud sync must not repaint its charts.
  const pageSession = useRef(session).current;
  const pageDiscoveries = useRef(discoveries).current;
  const entry = useMemo(() => sessionDetailEntry(pageSession, pageDiscoveries), [pageSession, pageDiscoveries]);
  const { analytics, regions, exploredByRegion, routeStatus, regionStatus } = useSyncExternalStore(entry.subscribe, entry.getSnapshot, entry.getSnapshot);
  useEffect(() => { void entry.load(); }, [entry]);
  const totalRoadType = analytics ? Object.values(analytics.roadTypes).reduce((sum, value) => sum + value, 0) : 0;
  const maxRegion = Math.max(1, ...(regions?.map(region => region.distance) ?? []));
  return <>
    <div className="session-detail-main">
      <button className="session-hero" type="button" onClick={() => setMapOpen(true)} aria-label="Open interactive route map">
        <span className="session-hero-image" aria-hidden="true">{preview}</span>
        <span className="session-hero-action"><ArrowsOutSimple size={18} aria-hidden="true" /> Explore map</span>
      </button>
      <div className="session-detail-body">
        <div className="session-detail-intro"><time dateTime={new Date(session.startedAt).toISOString()} className="roam-overline-sm text-text-subtle">{new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' }).format(session.startedAt)}</time><h1>{title}</h1></div>
        <div className="session-stat-grid">
          <div><span className="roam-overline-sm">Distance</span><strong>{formatDistance(session.distanceMeters)}</strong></div>
          <div><span className="roam-overline-sm">New roads</span><strong>{formatDistance(session.newDistanceMeters)}</strong></div>
          <div><span className="roam-overline-sm">Elapsed time</span><strong>{formatDuration(session.durationSeconds)}</strong></div>
          <div><span className="roam-overline-sm">Overall speed</span><strong>{session.durationSeconds > 0 ? `${(session.distanceMeters / session.durationSeconds * 3.6).toFixed(1)} km/h` : '—'}</strong></div>
        </div>
        <section className="session-insight-section"><div className="session-section-heading"><h2>Road types</h2></div>
          {totalRoadType > 0 ? <div className="session-road-types">{ROAD_TYPES.map(({ type, label }) => { const meters = analytics!.roadTypes[type]; const percent = meters / totalRoadType * 100; return <div key={type} className="session-bar-row"><div className="session-bar-row__labels"><span>{label}</span><strong className="session-road-type-values"><span className="session-road-type-distance">{formatDistance(meters)}</span><span className="session-road-type-separator" aria-hidden="true">•</span><span>{Math.round(percent)}%</span></strong></div><div className="session-bar-track"><span className={`session-bar-fill session-bar-fill--${type}`} style={{ width: `${percent}%` }} /></div></div>; })}</div> : <p className="session-empty-data" role="status">{routeStatus === 'ready' ? 'No mapped road types are available for this route.' : routeStatus === 'error' ? 'Road details could not be loaded right now.' : 'Loading road details…'}</p>}
        </section>
        <section className="session-insight-section"><div className="session-section-heading"><h2>New road discovery</h2></div>
          {analytics && (analytics.newSegments.length > 0 || session.newDistanceMeters === 0) ? <DiscoveryChart session={session} segments={analytics.newSegments} /> : <p className="session-empty-data" role="status">{routeStatus === 'ready' ? 'Timed road discovery data is unavailable for this ride.' : routeStatus === 'error' ? 'Road details could not be loaded right now.' : 'Loading road details…'}</p>}
        </section>
        <section className="session-insight-section"><div className="session-section-heading"><h2>Regions explored</h2></div>
          {regions?.length ? <div className="session-regions"><div className="session-region-legend"><span><i className="session-region-legend__ride" />This ride</span><span><i className="session-region-legend__overall" />Discovered overall</span></div>{regions.map(region => { const shares = regionDiscoveryShares(region.distance, exploredByRegion[region.id] ?? null, region.total); return <div key={region.id} className="session-bar-row"><div className="session-bar-row__labels"><span>{region.name}</span><strong>{formatDistance(region.distance)} new</strong></div><div className="session-bar-track session-region-bar" role="img" aria-label={`${region.name}: ${formatDistance(region.distance)} new roads this ride${shares?.overall === null || !shares ? '' : `, ${shares.overall.toFixed(1)} percent discovered overall`}`}><span className="session-region-bar__overall" style={{ width: `${shares?.overall ?? 0}%` }} /><span className="session-region-bar__ride" style={{ width: `${shares?.ride ?? region.distance / maxRegion * 100}%` }} /></div><p>{shares?.overall !== null && shares ? `${shares.overall.toFixed(1)}% discovered overall · +${shares.ride.toFixed(2)}% this ride` : 'Region coverage not calculated · ride distance shown'}</p></div>; })}</div> : <p className="session-empty-data" role="status">{regionStatus === 'error' ? 'API region details could not be loaded right now.' : regionStatus === 'ready' ? 'No new roads can be assigned to API regions for this ride.' : 'Loading API regions…'}</p>}
        </section>
      </div>
    </div>
    <Dialog open={mapOpen} onOpenChange={setMapOpen}><DialogContent className="session-map-dialog"><DialogTitle className="sr-only">Interactive route map</DialogTitle><DialogDescription className="sr-only">Pan and zoom around this ride. Use Back or Escape to close the map.</DialogDescription>{mapOpen && <LiveSessionMap session={session} />}<Button variant="secondary" size="icon-medium" className="session-map-back" aria-label="Back to session details" onClick={() => setMapOpen(false)}><ArrowLeft size={18} aria-hidden="true" /></Button><Button variant="secondary" size="icon-medium" className="session-map-close" aria-label="Close map" onClick={() => setMapOpen(false)}><X size={18} aria-hidden="true" /></Button></DialogContent></Dialog>
  </>;
}
