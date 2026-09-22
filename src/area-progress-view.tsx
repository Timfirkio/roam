import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { bbox } from '@turf/turf';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { areaApiBase, calculateArea, loadArea, lookupAreas, searchLocations, type LocationSearchResult } from './area-client';
import type { AreaRecord, AreaTotals } from './area-types';
import type { DiscoveredSegment } from './discovery';
import { installNetworkSource, NETWORK_SOURCE } from './network-source';
import { NETWORK_MIN_ZOOM } from './network-tiles';
import { applyRoamBaseStyle, ROAM_MAP_STYLE } from './roam-map-style';
import { Button } from './components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from './components/ui/item';
import { Spinner } from './components/ui/spinner';

const MAP_STYLE = ROAM_MAP_STYLE;
const AREA_SOURCE = 'roam-progress-areas';
const AREA_FILL = 'roam-progress-areas-fill';
const AREA_LINE = 'roam-progress-areas-line';
const AREA_TILE_SOURCE = 'roam-progress-area-tiles';
const AREA_TILE_FILL = 'roam-progress-area-tile-fills';
const AREA_TILE_LINE = 'roam-progress-area-tile-lines';
const DISCOVERED_SOURCE = 'roam-progress-discovered-network';
const DISCOVERED_LAYER = 'roam-progress-discovered-network-line';
const distance = (meters: number) => `${(meters / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
const message = (error: unknown) => error instanceof Error ? error.message : 'Could not load area coverage. Try again.';
const exploredTotalsCache = new Map<string, AreaTotals>();
const discoveryVersions = new WeakMap<DiscoveredSegment[], string>();

export function AnimatedProgressValue({ value, label, className = 'area-progress-percent' }: { value: number | null; label: string; className?: string }) {
  const initial = { label, value };
  const [current, setCurrent] = useState(initial);
  const [previous, setPrevious] = useState<typeof initial | null>(null);
  const currentRef = useRef(current);
  const valueRef = useRef(value);
  const timeoutRef = useRef<number | null>(null);
  valueRef.current = value;

  useEffect(() => {
    if (label === currentRef.current.label) return;
    const next = { label, value: valueRef.current };
    setPrevious(currentRef.current);
    setCurrent(next);
    currentRef.current = next;
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setPrevious(null), 460);
    return () => { if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current); };
  }, [label]);

  const increasing = previous !== null && value !== null && previous.value !== null && value > previous.value;
  return <span className={`${className}${previous ? ' area-progress-percent--changing' : ''}${increasing ? ' area-progress-percent--increasing' : ''}`} aria-live="polite" aria-atomic="true">
    {previous && <span className="area-progress-percent__previous" aria-hidden="true">{previous.label}</span>}
    <span className="area-progress-percent__current">{current.label}</span>
  </span>;
}

const scrambleCharacters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function ScrambleText({ text, className }: { text: string; className?: string }) {
  const [displayText, setDisplayText] = useState(text);
  const previousText = useRef(text);

  useEffect(() => {
    if (text === previousText.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { previousText.current = text; setDisplayText(text); return; }

    const characters = Array.from(text);
    const frames = 10;
    let frame = 0;
    const reveal = () => {
      const revealCount = Math.ceil(characters.length * frame / frames);
      setDisplayText(characters.map((character, index) => {
        if (index < revealCount || !/[\p{L}\p{N}]/u.test(character)) return character;
        return scrambleCharacters[Math.floor(Math.random() * scrambleCharacters.length)];
      }).join(''));
    };
    reveal();
    const interval = window.setInterval(() => {
      frame += 1;
      reveal();
      if (frame >= frames) { window.clearInterval(interval); previousText.current = text; }
    }, 28);
    return () => window.clearInterval(interval);
  }, [text]);

  return <span className={className}><span className="sr-only" aria-live="polite" aria-atomic="true">{text}</span><span aria-hidden="true">{displayText}</span></span>;
}

function AnimatedPercentage({ value, white = false }: { value: number | null; white?: boolean }) {
  const className = `area-progress-percent${white ? ' area-progress-percent--white' : ''}`;
  return <AnimatedProgressValue value={value} label={value === null ? '—' : `${Math.min(100, value).toFixed(1)}%`} className={className} />;
}

function discoveryVersion(discoveries: DiscoveredSegment[]) {
  const cached = discoveryVersions.get(discoveries);
  if (cached) return cached;
  const latest = discoveries.at(-1);
  const version = `${discoveries.length}:${latest?.id ?? ''}:${latest?.discoveredAt ?? 0}`;
  discoveryVersions.set(discoveries, version);
  return version;
}

function cachedExploredTotals(key: string) {
  const memory = exploredTotalsCache.get(key);
  if (memory) return memory;
  try {
    const stored = localStorage.getItem(`roam.area-progress.${key}`);
    if (!stored) return undefined;
    const totals = JSON.parse(stored) as AreaTotals;
    if (!Number.isFinite(totals.lengthMeters)) return undefined;
    exploredTotalsCache.set(key, totals);
    return totals;
  } catch { return undefined; }
}

export function AreaCoverageCard({ record, discoveries, onUpdate, onExplored, parentAreaName, className, onClick }: { record: AreaRecord; discoveries: DiscoveredSegment[]; onUpdate: (record: AreaRecord) => void; onExplored: (areaId: string, totals: AreaTotals) => void; parentAreaName?: string; className?: string; onClick?: () => void }) {
  const { area, job } = record;
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { totals: explored, refreshing, calculationError, isCurrent } = useExploredAreaTotals(discoveries, area.geometry, `${area.id}:${area.boundaryVersion}`);
  useEffect(() => { if (explored && isCurrent) onExplored(area.id, explored); }, [area.id, explored, isCurrent, onExplored]);
  const ready = job?.status === 'ready' && job.totals;
  const percentage = ready && explored && ready.lengthMeters > 0 ? explored.lengthMeters / ready.lengthMeters * 100 : null;
  const inconsistent = percentage !== null && percentage > 100.1;
  const pending = job?.status === 'queued' || job?.status === 'running';
  const segmentWidth = (type: keyof AreaTotals['byRoadType']) => ready && explored
    ? Math.min(100, explored.byRoadType[type] / ready.lengthMeters * 100)
    : 0;
  async function calculate() {
    setRequesting(true); setError(null);
    try { onUpdate(await calculateArea(area.id)); } catch (cause) { setError(message(cause)); }
    finally { setRequesting(false); }
  }
  return <Item variant="outline" className={`area-progress-card ${className ?? ''}`} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={event => { if (onClick && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onClick(); } }}>
    <ItemContent className="district-progress-content">
      {parentAreaName && <div className="district-progress-parent roam-overline-sm"><ScrambleText text={parentAreaName} /></div>}
      <div className="district-progress-top"><div className="district-progress-title"><ScrambleText text={area.name} /></div></div>
      <div className="progress-bar" aria-label={percentage !== null ? `${area.name}: ${Math.min(100, percentage).toFixed(1)} percent explored` : `${area.name}: coverage not calculated`}><i className="progress-bar__discovered"><em className="progress-bar__paved-roads" style={{ width: `${segmentWidth('paved-road')}%` }} /><em className="progress-bar__paved-cycleways" style={{ width: `${segmentWidth('cycleway')}%` }} /><em className="progress-bar__unpaved" style={{ width: `${segmentWidth('unpaved-path')}%` }} /></i></div>
      <div className="district-progress-readouts"><ItemDescription className="district-progress-description">{explored ? <><AnimatedProgressValue value={explored.lengthMeters} label={distance(explored.lengthMeters)} className="area-progress-distance" /><span className="district-progress-distance-separator"> / </span><AnimatedProgressValue value={ready ? ready.lengthMeters : null} label={ready ? distance(ready.lengthMeters) : '…'} className="area-progress-distance" /></> : ready ? <><AnimatedProgressValue value={0} label="0 km" className="area-progress-distance" /><span className="district-progress-distance-separator"> / </span><AnimatedProgressValue value={ready.lengthMeters} label={distance(ready.lengthMeters)} className="area-progress-distance" /></> : explored === undefined ? 'Calculating your progress…' : 'Coverage not calculated'}</ItemDescription><div className="district-progress-percent"><AnimatedPercentage white value={percentage !== null && !inconsistent ? percentage : null} /></div></div>
      <div role="status" className="area-progress-status">{refreshing && explored && <span>Updating progress…</span>}{calculationError && <span>Progress could not be calculated: {calculationError}</span>}{pending && <span>{job.status === 'queued' ? 'Queued' : `Calculating · ${job.completedTiles} of ${job.totalTiles} tiles`}</span>}{job?.status === 'failed' && <span>{job.error ?? 'Calculation failed. Retry to resume.'}</span>}{ready && ready.lengthMeters === 0 && 'No eligible roads in this map snapshot.'}{inconsistent && 'The saved discoveries and current map differ. Coverage needs reconciliation.'}{error && <span>{error}</span>}</div>
      {!ready && <ItemActions className="area-progress-actions"><Button variant="secondary" size="small" disabled={pending || requesting} onClick={event => { event.stopPropagation(); void calculate(); }}>{requesting ? <Spinner /> : null}{job?.status === 'failed' ? 'Retry calculation' : 'Calculate coverage'}</Button></ItemActions>}
    </ItemContent>
  </Item>;
}

function useExploredAreaTotals(discoveries: DiscoveredSegment[], geometry: AreaRecord['area']['geometry'], areaKey: string) {
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const [result, setResult] = useState<{ key: string; totals: AreaTotals } | null>(null);
  const [calculationError, setCalculationError] = useState<string | null>(null);
  const key = geometry ? `${areaKey}:${discoveryVersion(discoveries)}` : null;
  const cached = key ? cachedExploredTotals(key) : undefined;
  // Keep the previously rendered measurement on screen while the worker
  // calculates the selected area's next value. Besides avoiding an empty bar,
  // this gives the progress meter a meaningful value to animate from.
  const totals = key === null ? null : result?.key === key ? result.totals : cached ?? result?.totals;
  const refreshing = key !== null && result?.key !== key && !cached;
  const isCurrent = key !== null && (result?.key === key || Boolean(cached));
  useEffect(() => {
    if (!geometry || !key) return;
    if (cached) { setResult({ key, totals: cached }); return; }
    const worker = workerRef.current ?? (workerRef.current = new Worker(new URL('./area-progress-worker.ts', import.meta.url), { type: 'module' }));
    const id = ++requestId.current;
    setCalculationError(null);
    const receive = ({ data }: MessageEvent<{ id: number; totals?: AreaTotals; error?: string }>) => {
      if (data.id !== id) return;
      if (data.error || !data.totals) { setCalculationError(data.error ?? 'Could not calculate area progress.'); return; }
      exploredTotalsCache.set(key, data.totals);
      try { localStorage.setItem(`roam.area-progress.${key}`, JSON.stringify(data.totals)); } catch {}
      setResult({ key, totals: data.totals });
    };
    const fail = () => setCalculationError('Could not calculate area progress.');
    worker.addEventListener('message', receive);
    worker.addEventListener('error', fail);
    worker.postMessage({ id, discoveries, geometry });
    return () => { worker.removeEventListener('message', receive); worker.removeEventListener('error', fail); };
  }, [cached, discoveries, geometry, key]);
  useEffect(() => () => workerRef.current?.terminate(), []);
  return { totals, refreshing, calculationError, isCurrent };
}

function hierarchyLevel(zoom: number) {
  if (zoom < 5) return 2;
  if (zoom < 7) return 4;
  if (zoom < 8) return 6;
  // Municipal borders remain useful at a regional view. Level 9 is the most
  // granular reliable OSM tier we show; neighbourhood-level boundaries vary
  // too much between municipalities to make a coherent county-wide map.
  if (zoom < 10) return 7;
  return 9;
}

type HoveredArea = { id: string; name: string; adminLevel: number };

function ProgressMap({ centre, discoveries, selected, onSelectId, onHover }: { centre: [number, number]; discoveries: DiscoveredSegment[]; selected: AreaRecord | null; onSelectId: (id: string) => void; onHover: (area: HoveredArea | null) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onSelectIdRef = useRef(onSelectId); onSelectIdRef.current = onSelectId;
  const onHoverRef = useRef(onHover); onHoverRef.current = onHover;
  const hoveredId = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({ container: containerRef.current, style: MAP_STYLE, center: centre, zoom: 12, pitch: 0, bearing: 0, attributionControl: false });
    mapRef.current = map;
    let removeNetworkProtocol = () => {};
    map.on('load', () => {
      removeNetworkProtocol = installNetworkSource(map);
      applyRoamBaseStyle(map);
      // The Map and Progress tabs share the same OSM treatment. At cycling
      // zooms, replace the generalized bikeable paths with full z14 geometry.
      const overview = map.getStyle().layers?.find((layer: any) => layer.id === 'roam-bikeable-paths');
      if (overview?.type === 'line' && map.getSource(NETWORK_SOURCE) && !map.getLayer('roam-bikeable-paths-detail')) {
        map.addLayer({ ...overview, id: 'roam-bikeable-paths-detail', source: NETWORK_SOURCE, minzoom: NETWORK_MIN_ZOOM }, 'roam-bikeable-paths');
        map.setLayerZoomRange('roam-bikeable-paths', 6, NETWORK_MIN_ZOOM);
      }
      map.addSource(DISCOVERED_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: DISCOVERED_LAYER, type: 'line', source: DISCOVERED_SOURCE, minzoom: 6, maxzoom: 24,
        paint: { 'line-color': ['match', ['get', 'roadType'], 'cycleway', '#2bb8b0', 'unpaved-path', '#d59c67', 'footpath', '#2bb8b0', '#f0eee7'], 'line-opacity': 1, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 1.2, 15, 1.8, 18, 3] },
      } as any);
      map.addSource(AREA_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      if (import.meta.env.VITE_AREA_CATALOG !== 'false') {
        map.addSource(AREA_TILE_SOURCE, { type: 'vector', tiles: [`${areaApiBase}/tiles/{z}/{x}/{y}.mvt?v=2`], minzoom: 0, maxzoom: 22, promoteId: 'id' });
        const levelFilter = () => hierarchyLevel(map.getZoom()) === 9
          ? ['>=', ['get', 'admin_level'], 7] as any
          : ['==', ['get', 'admin_level'], hierarchyLevel(map.getZoom())] as any;
        map.addLayer({ id: AREA_TILE_FILL, type: 'fill', source: AREA_TILE_SOURCE, 'source-layer': 'boundaries', filter: levelFilter(), paint: { 'fill-color': '#2bb8b0', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.25, 0.12] } } as any);
        map.addLayer({ id: AREA_TILE_LINE, type: 'line', source: AREA_TILE_SOURCE, 'source-layer': 'boundaries', filter: levelFilter(), paint: { 'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#f0eee7', '#72d3cc'], 'line-opacity': 1, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 12, 1.65, 18, 2.8] } } as any);
        map.on('zoomend', () => {
          const filter = levelFilter();
          map.setFilter(AREA_TILE_FILL, filter);
          map.setFilter(AREA_TILE_LINE, filter);
          onHoverRef.current(null);
        });
        const tileFeature = (event: maplibregl.MapLayerMouseEvent): HoveredArea | null => {
          const feature = event.features?.[0];
          const id = String(feature?.properties?.id ?? '');
          const name = String(feature?.properties?.name ?? '');
          const adminLevel = Number(feature?.properties?.admin_level);
          return id && name && Number.isFinite(adminLevel) ? { id, name, adminLevel } : null;
        };
        map.on('click', AREA_TILE_FILL, event => { const area = tileFeature(event); if (area) onSelectIdRef.current(area.id); });
        map.on('mousemove', AREA_TILE_FILL, event => {
          const area = tileFeature(event);
          if (area?.id === hoveredId.current) return;
          if (hoveredId.current) map.setFeatureState({ source: AREA_TILE_SOURCE, sourceLayer: 'boundaries', id: hoveredId.current }, { hover: false });
          hoveredId.current = area?.id ?? null;
          if (area) map.setFeatureState({ source: AREA_TILE_SOURCE, sourceLayer: 'boundaries', id: area.id }, { hover: true });
          map.getCanvas().style.cursor = area ? 'pointer' : '';
          onHoverRef.current(area);
        });
        map.on('mouseleave', AREA_TILE_FILL, () => {
          if (hoveredId.current) map.setFeatureState({ source: AREA_TILE_SOURCE, sourceLayer: 'boundaries', id: hoveredId.current }, { hover: false });
          hoveredId.current = null;
          map.getCanvas().style.cursor = '';
          onHoverRef.current(null);
        });
      }
      map.addLayer({ id: AREA_FILL, type: 'fill', source: AREA_SOURCE, paint: { 'fill-color': '#2bb8b0', 'fill-opacity': ['case', ['boolean', ['get', 'selected'], false], 0.16, 0.06] } });
      map.addLayer({ id: AREA_LINE, type: 'line', source: AREA_SOURCE, paint: { 'line-color': ['case', ['boolean', ['get', 'selected'], false], '#f0eee7', '#5fbbb4'], 'line-width': ['interpolate', ['linear'], ['zoom'], 7, ['case', ['boolean', ['get', 'selected'], false], 2.2, 1.25], 13, ['case', ['boolean', ['get', 'selected'], false], 3.2, 1.8], 18, ['case', ['boolean', ['get', 'selected'], false], 4, 2.4]], 'line-opacity': 1 } });
      setReady(true);
    });
    return () => { map.remove(); removeNetworkProtocol(); mapRef.current = null; };
  }, []);
  useEffect(() => { const map = mapRef.current; if (map && !map.isMoving()) map.easeTo({ center: centre, duration: 550 }); }, [centre[0], centre[1]]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map?.getSource(DISCOVERED_SOURCE)) return;
    (map.getSource(DISCOVERED_SOURCE) as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: discoveries.map(segment => ({ type: 'Feature', properties: { roadType: segment.roadType }, geometry: segment.geometry })) } as any);
  }, [discoveries, ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map?.getSource(AREA_SOURCE)) return;
    (map.getSource(AREA_SOURCE) as maplibregl.GeoJSONSource).setData(selected?.area.geometry
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { selected: true }, geometry: selected.area.geometry }] }
      : { type: 'FeatureCollection', features: [] });
  }, [ready, selected?.area.geometry, selected?.area.id]);
  useEffect(() => { const map = mapRef.current; if (!map || !selected?.area.geometry) return; const [west, south, east, north] = bbox(selected.area.geometry as any); map.fitBounds([[west, south], [east, north]], { padding: { top: 116, right: 36, bottom: 244, left: 36 }, maxZoom: 14, duration: 600 }); }, [selected?.area.id, selected?.area.geometry]);
  return <div className="progress-map-canvas"><div ref={containerRef} className="maplibre-container maplibre-container--ready" aria-label="Area progress map" /></div>;
}

function LocationSearch({ onSelect }: { onSelect: (result: LocationSearchResult) => void }) {
  const [query, setQuery] = useState(''); const [results, setResults] = useState<LocationSearchResult[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { const term = query.trim(); if (term.length < 2) { setResults([]); setError(null); return; } const controller = new AbortController(); const timer = setTimeout(() => { setLoading(true); setError(null); void searchLocations(term, controller.signal).then(({ results: next }) => setResults(next)).catch(cause => { if (!controller.signal.aborted) setError(message(cause)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); }, 350); return () => { controller.abort(); clearTimeout(timer); }; }, [query]);
  return <div className="progress-map-search"><label className="sr-only" htmlFor="area-location-search">Search for a location</label><div className="progress-map-search-input"><MagnifyingGlass aria-hidden="true" /><input id="area-location-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search places, regions, or addresses" autoComplete="off" />{loading ? <Spinner /> : query && <button type="button" aria-label="Clear location search" onClick={() => setQuery('')}><X /></button>}</div>{(results.length > 0 || error) && <div className="progress-map-search-results" role="listbox" aria-label="Location results">{error && <p role="alert">{error}</p>}{results.map(result => <button type="button" key={result.id} role="option" onClick={() => { onSelect(result); setQuery(''); setResults([]); }}><strong>{result.name.split(',').slice(0, 2).join(',')}</strong><small>{result.type}</small></button>)}</div>}</div>;
}

export function AreaProgressView({ location, discoveries }: { location: { lng: number; lat: number }; discoveries: DiscoveredSegment[] }) {
  const [centre, setCentre] = useState<[number, number]>([location.lng, location.lat]); const [records, setRecords] = useState<AreaRecord[]>([]); const [selected, setSelected] = useState<AreaRecord | null>(null); const [hovered, setHovered] = useState<HoveredArea | null>(null); const [error, setError] = useState<string | null>(null); const [exploredByArea, setExploredByArea] = useState<Record<string, AreaTotals>>({}); const recordsRef = useRef(records); recordsRef.current = records;
  useEffect(() => { const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>; const poll = async () => { const pending = recordsRef.current.filter(record => record.job?.status === 'queued' || record.job?.status === 'running'); if (pending.length) { try { const updates = await Promise.all(pending.map(record => loadArea(record.area.id, controller.signal, true))); if (!controller.signal.aborted) { setRecords(current => current.map(record => updates.find(update => update.area.id === record.area.id) ?? record)); setSelected(current => updates.find(update => update.area.id === current?.area.id) ?? current); } } catch {} } if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 3000); }; timer = setTimeout(() => void poll(), 3000); return () => { controller.abort(); clearTimeout(timer); }; }, []);
  const updateRecord = (updated: AreaRecord) => { setRecords(current => current.map(record => record.area.id === updated.area.id ? updated : record)); setSelected(current => current?.area.id === updated.area.id ? updated : current); };
  const saveExplored = useCallback((areaId: string, totals: AreaTotals) => { setExploredByArea(current => current[areaId] === totals ? current : { ...current, [areaId]: totals }); }, []);
  const select = (id: string) => {
    setError(null);
    void loadArea(id, undefined, true).then(record => {
      setRecords(current => [...current.filter(item => item.area.id !== record.area.id), record]);
      setSelected(record);
    }).catch(cause => setError(message(cause)));
  };
  useEffect(() => {
    const controller = new AbortController();
    void lookupAreas(centre[0], centre[1], controller.signal).then(async ({ areas }) => {
      const candidate = areas.filter(record => record.area.adminLevel >= 7 && record.area.adminLevel <= 9).sort((left, right) => right.area.adminLevel - left.area.adminLevel)[0];
      if (!candidate) return;
      const record = await loadArea(candidate.area.id, controller.signal, true);
      if (controller.signal.aborted) return;
      setRecords(current => [...current.filter(item => item.area.id !== record.area.id), record]);
      setSelected(record);
    }).catch(cause => { if (!controller.signal.aborted) setError(message(cause)); });
    return () => controller.abort();
  }, [centre[0], centre[1]]);
  const hoveredRecord = hovered ? records.find(record => record.area.id === hovered.id) : null;
  // Hover stays lightweight: values are reused after an area has been selected
  // and calculated in the card's Web Worker, never in a mouse-move handler.
  const hoveredProgress = hovered ? exploredByArea[hovered.id] ?? null : null;
  const hoveredTotal = hoveredRecord?.job?.status === 'ready' ? hoveredRecord.job.totals?.lengthMeters ?? null : null;
  const hoveredPercentage = hoveredProgress && hoveredTotal && hoveredTotal > 0 ? Math.min(100, hoveredProgress.lengthMeters / hoveredTotal * 100) : null;
  return <section className="progress-map-view"><ProgressMap centre={centre} discoveries={discoveries} selected={selected} onSelectId={select} onHover={setHovered} /><LocationSearch onSelect={result => { setCentre([result.lng, result.lat]); select(result.id); }} />{hovered && <div className="progress-map-hover" role="status"><strong>{hovered.name}</strong><span>{hoveredPercentage === null ? '—' : `${hoveredPercentage.toFixed(1)}%`}</span></div>}{selected && <div className="progress-map-overlay"><AreaCoverageCard record={selected} discoveries={discoveries} onUpdate={updateRecord} onExplored={saveExplored} /></div>}{error && <div className="progress-map-message" role="alert">{error}</div>}</section>;
}
