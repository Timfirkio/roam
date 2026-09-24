import { StrictMode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatedProgressValue, AreaCoverageCard, ScrambleText } from './area-progress-view';
import { cachedExploredTotals, calculateExploredAreaTotals, exploredTotalsKey } from './area-progress-calculation';
import { areaTileUrlTemplate, loadArea, lookupAreas } from './area-client';
import { displayAreaName, shortRegionName } from './area-display-name';
import type { AreaRecord, AreaTotals } from './area-types';
import maplibregl, { type Map } from 'maplibre-gl';
import { area, bbox, booleanPointInPolygon, centerOfMass, circle, pointOnFeature } from '@turf/turf';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { installNetworkSource, NETWORK_SOURCE } from './network-source';
import { NETWORK_MIN_ZOOM } from './network-tiles';
import { DISCOVERY_RADIUS_METERS, discoverSegments, type DiscoveredSegment, type RoadCandidate } from './discovery';
import { loadDiscoveredSegments, saveDiscoveredSegments } from './discovery-store';
import { findStockholmDistrict, STOCKHOLM_DISTRICTS, type StockholmDistrict } from './stockholm-catalog';
import { STOCKHOLM_MUNICIPALITY, STOCKHOLM_REGION_BY_DISTRICT, STOCKHOLM_REGIONS } from './stockholm-hierarchy';
import { SWEDEN_MUNICIPALITIES, SWEDEN_MUNICIPALITIES_SORTED } from './sweden-municipalities';
import { distanceMeters, nextNavigationState, type NavigationState } from './player-navigation';
import { Geolocation, type CallbackID, type Position } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import { RideTracking, type RideTrackingPoint } from './ride-background-tracking';
import { deleteSession, loadSessions, saveSession, type RideSession } from './session-store';
import { reconcileSessionRoute, synchronizeDiscoveredSegmentRoadTypes } from './session-route-reconciliation';
import { generateSessionThumbnail } from './session-thumbnail';
import { formatSessionTitle, isGeneratedSessionTitle, regionNamesForSession, SESSION_NAMING_VERSION, titleForRegions } from './session-naming';
import { applyRoamBaseStyle } from './roam-map-style';
import { boundaryLineOpacity, boundaryMatchesLevel, mapBoundaryLevel } from './map-boundary-level';
import { isDiscoverableProperties, legacyRoadTypeForProperties, roadTypeForProperties, stableRoadCandidateId } from './road-rules';
import { STOCKHOLM_ROAD_NETWORK_BY_DISTRICT } from './road-network-catalog';
import { Button as ShadcnButton, buttonVariants } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Select } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs as ShadcnTabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Toaster, toastManager } from '@/components/ui/toast';
import { useScreenWakeLock } from './use-screen-wake-lock';
import { AccountSettings } from './account-settings';
import { runAccountSync } from './cloud-sync';
import { formatDistance } from './distance-format';
import { supabase } from './supabase';
import { ArrowsClockwise, CheckCircle, Compass, CrosshairSimple, Cube, DotsThreeOutline, DownloadSimple, Gear, Gps, GpsFix, MapTrifold, Minus, NavigationArrow, Path, PencilSimple, Percent, Plus, Stack, Trash, UploadSimple } from '@phosphor-icons/react';

type View = 'map' | 'sessions' | 'settings' | 'design-system';
type LocationState = { city: string; region: string; lng: number; lat: number };
type GpsPermission = 'prompt' | 'granted' | 'denied';
type PlayerLocation = NavigationState & { accuracy: number };

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const TERRAIN_SOURCE = 'roam-terrain';
const HILLSHADE_SOURCE = 'roam-hillshade';
const TERRAIN_TILEJSON = 'https://tiles.mapterhorn.com/tilejson.json';
const TERRAIN_LOD_LEVELS = 2;
const TERRAIN_TILE_RATIO = 1.5;
const TERRAIN_EXAGGERATION = 1.05;
const ROAD_MIN_ZOOM = 6;
const ROAD_MAX_ZOOM = 24;
const DEFAULT_MAP_ZOOM = 15;
const RECORDING_MAP_ZOOM = 16;
const DEFAULT_3D_PITCH = 60;
const MAX_MAP_PITCH = 64;
const UNPAVED_SURFACES = ['gravel', 'fine_gravel', 'dirt', 'earth', 'ground', 'unpaved', 'mud', 'sand', 'grass', 'woodchips', 'pebblestone', 'compacted'];
const PATH_CLASSES = ['cycleway', 'path', 'pedestrian', 'footway', 'track', 'bridleway'];
const LOCAL_STREET_CLASSES = ['minor', 'tertiary', 'secondary', 'residential', 'living_street', 'unclassified'];
const NON_BIKEABLE_ROAD_CLASSES = ['motorway', 'trunk', 'primary'];
const explicitBikeAccessFeature = ['match', ['get', 'bicycle'], ['yes', 'designated', 'permissive'], true, false] as any;
const nonBikeableRoadFeature = ['all', ['!', ['match', ['get', 'class'], PATH_CLASSES, true, false]], ['!', explicitBikeAccessFeature], ['any', ['match', ['get', 'class'], NON_BIKEABLE_ROAD_CLASSES, true, false], ['match', ['get', 'subclass'], ['link'], true, false], ['match', ['get', 'bicycle'], ['no'], true, false], ['match', ['get', 'access'], ['no', 'private'], true, false], ['match', ['get', 'vehicle'], ['no'], true, false], ['match', ['get', 'motor_vehicle'], ['no'], true, false]]] as any;
const DEFAULT_LOCATION: LocationState = { city: 'STOCKHOLM', region: 'SÖDERMALM', lng: 18.0649, lat: 59.3326 };
const GPS_ENABLED_STORAGE_KEY = 'roam.gps.enabled';
const GPS_PERMISSION_STORAGE_KEY = 'roam.gps.permission';
const LAST_MAP_CENTER_STORAGE_KEY = 'roam.map.last-center';
const DISCOVERY_ROAD_TYPE_MIGRATION_KEY = 'roam.discovery.road-types.v4';
const DISCOVERED_SOURCE = 'roam-discovered-network';
const REGION_BOUNDARIES_SOURCE = 'roam-catalog-boundaries';
const REGION_BOUNDARIES_FILL = 'roam-catalog-boundaries-fill';
const REGION_BOUNDARIES_LINE = 'roam-catalog-boundaries-line';
const REGION_BOUNDARY_LEVELS = [2, 4, 7, 9] as const;
const regionBoundaryLineId = (level: typeof REGION_BOUNDARY_LEVELS[number]) => level === 9 ? REGION_BOUNDARIES_LINE : `${REGION_BOUNDARIES_LINE}-${level}`;
const REGION_BOUNDARIES_LINES = REGION_BOUNDARY_LEVELS.map(regionBoundaryLineId);
const REGION_BOUNDARY_COLOR = '#d59c67';
const CURRENT_AREA_SOURCE = 'roam-current-area';
const CURRENT_AREA_FILL = 'roam-current-area-fill';
const CURRENT_AREA_LINE = 'roam-current-area-line';
const PLAYER_DISCOVERY_SOURCE = 'roam-player-discovery-radius';
const PLAYER_DISCOVERY_FILL = 'roam-player-discovery-radius-fill';
const PLAYER_DISCOVERY_LINE = 'roam-player-discovery-radius-line';
const SESSION_THUMBNAIL_STYLE_VERSION = 4;
const mapAreaCache = new globalThis.Map<string, AreaRecord>();
const ignoreMapAreaExplored = (_areaId: string, _totals: AreaTotals) => {};

const surfaceColor = (pavedColor: string, unpavedColor: string) =>
  ['match', ['get', 'surface'], UNPAVED_SURFACES, unpavedColor, pavedColor] as any;

const cyclewayFeature = ['any', ['match', ['get', 'class'], ['cycleway'], true, false], ['match', ['get', 'subclass'], ['cycleway'], true, false]] as any;
const discoveryAccessDeniedFeature = ['any', ['match', ['get', 'bicycle'], ['no'], true, false], ['match', ['get', 'access'], ['no', 'private'], true, false], ['match', ['get', 'vehicle'], ['no'], true, false], ['match', ['get', 'motor_vehicle'], ['no'], true, false]] as any;
const pathAccessFeature = ['all', ['!', discoveryAccessDeniedFeature], ['any', cyclewayFeature, ['match', ['get', 'bicycle'], ['yes', 'designated', 'permissive'], true, false], ['match', ['get', 'foot'], ['yes', 'designated', 'permissive'], true, false]]] as any;
const networkExclusionFilter = ['all', ['!', nonBikeableRoadFeature], ['!=', ['get', 'class'], 'parking_aisle'], ['!=', ['get', 'class'], 'service']] as any;
const bikeablePathEligibilityFilter = ['all', ['match', ['get', 'class'], PATH_CLASSES, true, false], pathAccessFeature] as any;
const unpavedBikeablePathFeature = ['all', bikeablePathEligibilityFilter, ['match', ['get', 'surface'], UNPAVED_SURFACES, true, false]] as any;
const localRoadEligibilityFilter = ['all', ['match', ['get', 'class'], LOCAL_STREET_CLASSES, true, false], ['!=', ['get', 'bicycle'], 'no']] as any;
const bikeablePathFilter = ['all', networkExclusionFilter, bikeablePathEligibilityFilter] as any;

type ProgressStats = {
  discovered: number;
  pavedBikeableRoads: number;
  pavedCycleways: number;
  unpavedPaths: number;
};

const CURRENT_PROGRESS: ProgressStats = { discovered: 0, pavedBikeableRoads: 0, pavedCycleways: 0, unpavedPaths: 0 };

function bikeableLengthMeters(denominator: { lengthMeters: number }) {
  return denominator.lengthMeters;
}

function bikeableDiscoveredMeters(discoveries: DiscoveredSegment[]) {
  return discoveries.reduce((total, segment) => total + segment.lengthMeters, 0);
}

function ProgressBar({ stats, className = '' }: { stats: ProgressStats; className?: string }) {
  return <div className={`progress-bar ${className}`}><i className="progress-bar__discovered"><em className="progress-bar__paved-roads" style={{ width: `${stats.pavedBikeableRoads}%` }} /><em className="progress-bar__paved-cycleways" style={{ width: `${stats.pavedCycleways}%` }} /><em className="progress-bar__unpaved" style={{ width: `${stats.unpavedPaths}%` }} /></i></div>;
}

function ProgressTransitionPreview() {
  const regions = [{ name: 'Södermalm', percentage: 37.4 }, { name: 'Norrmalm', percentage: 52.8 }, { name: 'Kungsholmen', percentage: 18.6 }];
  const [regionIndex, setRegionIndex] = useState(0);
  const [percentage, setPercentage] = useState(regions[0].percentage);
  const update = (nextIndex: number, nextPercentage: number) => {
    setRegionIndex(nextIndex);
    setPercentage(nextPercentage);
  };
  const nextRegion = () => {
    const nextIndex = (regionIndex + 1) % regions.length;
    update(nextIndex, regions[nextIndex].percentage);
  };
  const stats = { discovered: percentage, pavedBikeableRoads: percentage * .55, pavedCycleways: percentage * .3, unpavedPaths: percentage * .15 };
  const discoveredDistance = percentage * .224;
  return <div>
    <p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">DISTRICT PROGRESS CARD</p>
    <Surface className="space-y-4 p-4">
      <p className="text-body text-text-muted">Map card for the active district. The parent region is contextual, the bar stays visible during recalculation without a loading spinner, and both distance and completion readings roll with their values.</p>
      <div className="district-progress-content map-district-progress-preview rounded-control border border-border-muted bg-surface p-4">
        <div className="district-progress-parent roam-overline-sm"><ScrambleText text="Stockholms kommun" /></div>
        <div className="district-progress-top"><div className="district-progress-title"><ScrambleText text={regions[regionIndex].name} /></div></div>
        <ProgressBar stats={stats} />
        <div className="district-progress-readouts"><div className="district-progress-description"><AnimatedProgressValue value={discoveredDistance} label={`${discoveredDistance.toFixed(1)} km`} className="area-progress-distance" /><span className="district-progress-distance-separator"> / </span><AnimatedProgressValue value={22.4} label="22.4 km" className="area-progress-distance" /></div><div className="district-progress-percent"><AnimatedProgressValue value={percentage} label={`${percentage.toFixed(1)}%`} className="area-progress-percent area-progress-percent--white" /></div></div>
        <span className="text-label text-text-subtle">Updating progress…</span>
      </div>
      <div className="flex flex-wrap gap-3"><ShadcnButton variant="secondary" size="small" onClick={() => update(regionIndex, Math.min(100, percentage + 1.2))}>Add coverage</ShadcnButton><ShadcnButton variant="secondary" size="small" onClick={() => update(regionIndex, Math.max(0, percentage - 1.2))}>Reduce coverage</ShadcnButton><ShadcnButton variant="secondary" size="small" onClick={nextRegion}>Change region</ShadcnButton></div>
    </Surface>
  </div>;
}

function DistrictProgressContent({ title, distance, percentage, stats }: { title: ReactNode; distance: string; percentage: string; stats: ProgressStats }) {
  return <div className="district-progress-content"><div className="district-progress-top"><div className="district-progress-title">{title}</div><div className="district-progress-percent">{percentage}</div></div><div className="district-progress-description">{distance}</div><ProgressBar stats={stats} />
  </div>;
}

function formatSessionTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${seconds}s`;
}

function formatSessionDateTime(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const sessionDayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDifference = Math.round((dayStart - sessionDayStart) / 86_400_000);
  const label = dayDifference === 0 ? 'Today' : dayDifference === 1 ? 'Yesterday' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).replace(/,(?=\s*\d{4}\b)/, '');
  return `${label} at ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

function gpxDocument(points: RideTrackingPoint[]) {
  const escapeXml = (value: string) => value.replace(/[<>&'\"]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character]!);
  const trackPoints = points
    .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng) && Number.isFinite(point.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(point => `      <trkpt lat="${point.lat}" lon="${point.lng}"><time>${new Date(point.timestamp).toISOString()}</time>${typeof point.speed === 'number' ? `<extensions><speed>${point.speed}</speed></extensions>` : ''}</trkpt>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Roam" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${escapeXml('Roam ride')}</name></metadata>\n  <trk><name>${escapeXml('Roam ride')}</name><trkseg>\n${trackPoints}\n  </trkseg></trk>\n</gpx>\n`;
}

function downloadGpx(contents: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/gpx+xml' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function pointsFromGpx(contents: string): { points: RideTrackingPoint[]; title: string | null } {
  const document = new DOMParser().parseFromString(contents, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('The GPX file could not be read.');
  const title = [...document.querySelectorAll('metadata > name, trk > name, rte > name')]
    .map(element => element.textContent?.trim() ?? '')
    .find(Boolean) || null;
  const fallbackTimestamp = Date.now();
  const points = [...document.querySelectorAll('trkpt, rtept')].map((element, index) => {
    const lat = Number(element.getAttribute('lat'));
    const lng = Number(element.getAttribute('lon'));
    const parsedTimestamp = Date.parse(element.querySelector('time')?.textContent ?? '');
    return {
      lat,
      lng,
      accuracy: 10,
      timestamp: Number.isFinite(parsedTimestamp) ? parsedTimestamp : fallbackTimestamp + index * 1000,
      speed: null,
      bearing: null,
    } satisfies RideTrackingPoint;
  }).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180);
  if (points.length < 2) throw new Error('The GPX file needs at least two route points.');
  return { points: points.sort((a, b) => a.timestamp - b.timestamp), title };
}

function assignDiscoveryRegions(segments: DiscoveredSegment[]) {
  return segments.map(segment => {
    if (segment.regionId) return segment;
    const coordinates = segment.geometry.coordinates;
    const coordinate = coordinates[Math.floor(coordinates.length / 2)] ?? coordinates[0];
    const district = coordinate && findStockholmDistrict(coordinate);
    return district ? { ...segment, regionId: district.id, regionName: district.name } : segment;
  });
}

function AccordionSummary({ title, percentage }: { title: ReactNode; percentage: string }) {
  return <div className="accordion-summary"><div className="accordion-summary-title">{title}</div><div className="accordion-summary-end"><span className="district-progress-percent">{percentage}</span><span className="accordion-chevron" aria-hidden="true" /></div></div>;
}

function areaLabelPoint(geometry: NonNullable<AreaRecord['area']['geometry']>): [number, number] {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const largest = polygons.reduce((best, coordinates) => area({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } } as any) > area({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: best } } as any) ? coordinates : best);
  const feature = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: largest } } as any;
  const centre = centerOfMass(feature).geometry.coordinates as [number, number];
  return booleanPointInPolygon(centre, feature) ? centre : pointOnFeature(feature).geometry.coordinates as [number, number];
}

function refreshMapBoundaryLevel(map: Map) {
  const level = mapBoundaryLevel(map.getZoom());
  const filter = level === 9
    ? ['==', ['to-number', ['get', 'display_level'], ['to-number', ['get', 'admin_level'], 0]], 9]
    : ['==', ['to-number', ['get', 'admin_level'], 0], level];
  if (map.getLayer(REGION_BOUNDARIES_FILL)) map.setFilter(REGION_BOUNDARIES_FILL, filter as any);
}

function styleRoamMap(map: Map, showDiscovered: boolean, showRegionProgress: boolean, progressMode: boolean, is3D: boolean, showBuildings3D: boolean, showTerrain3D: boolean) {
  applyRoamBaseStyle(map);
  const layers = map.getStyle().layers ?? [];
  const firstRoadLayer = layers.find((layer: any) => layer.type === 'line' && ('source-layer' in layer ? layer['source-layer'] === 'transportation' : false))?.id;
  const showBuildingExtrusions = is3D && showBuildings3D && !showTerrain3D;
  const showBuildingFootprints = is3D && showBuildings3D && showTerrain3D;
  map.setPaintProperty('background', 'background-color', '#0a0b0c');
  for (const layer of layers) {
    const id = layer.id.toLowerCase();
    const sourceLayer = 'source-layer' in layer && typeof layer['source-layer'] === 'string' ? layer['source-layer'].toLowerCase() : '';
    const isRoamOverlay = id.startsWith('roam-');
    const isRoad = !isRoamOverlay && (id.includes('transportation') || sourceLayer === 'transportation');
    const isRail = /rail/.test(id) || /(^|_)transit(_|$)/.test(id);
    const isHighway = /motorway|trunk|primary|secondary/.test(id);
    const isWater = id.includes('water') || sourceLayer === 'water';
    const isPark = /park|wood|forest|grass|meadow|cemetery|recreation|garden|landcover/.test(id) || /landcover|landuse/.test(sourceLayer);
    const isRestricted = /military|aeroway|airport|airfield/.test(id) || /military|aeroway/.test(sourceLayer);
    if (layer.type === 'symbol' || id.includes('building') || id.includes('boundary') || id === 'park_outline' || id === 'landcover_wetland' || id === 'road_area_pattern' || isRail || (isRestricted && layer.type === 'line')) {
      map.setLayoutProperty(layer.id, 'visibility', 'none');
    }
    if (layer.type === 'fill' && isWater) {
      map.setPaintProperty(layer.id, 'fill-color', '#102331');
      map.setPaintProperty(layer.id, 'fill-opacity', 0.92);
    }
    if (layer.type === 'fill' && isPark) {
      map.setPaintProperty(layer.id, 'fill-color', '#0e1b17');
      map.setPaintProperty(layer.id, 'fill-opacity', 0.86);
      if (id === 'park') map.setPaintProperty(layer.id, 'fill-outline-color', '#13251f');
    }
    if (layer.type === 'fill' && isRestricted) {
      map.setPaintProperty(layer.id, 'fill-color', '#241216');
      map.setPaintProperty(layer.id, 'fill-opacity', 0.9);
      map.setPaintProperty(layer.id, 'fill-outline-color', '#241216');
    }
    if (layer.type === 'line' && isWater) {
      map.setPaintProperty(layer.id, 'line-color', '#24465a');
      map.setPaintProperty(layer.id, 'line-opacity', 0.8);
    }
    if (layer.type === 'line' && isRestricted) {
      map.setPaintProperty(layer.id, 'line-color', '#6b3038');
      map.setPaintProperty(layer.id, 'line-opacity', 0.85);
    }
    if (isRoad && layer.type === 'line') {
      const isCycleway = /cycleway/.test(id);
      const isPedestrianFootpath = /footway|pedestrian/.test(id);
      const isGravelPath = /track|path|bridleway/.test(id) && !isPedestrianFootpath && !isCycleway;
      const isPath = isCycleway || isPedestrianFootpath || isGravelPath;
      const isMajor = /motorway|trunk|primary/.test(id);
      map.setLayerZoomRange(layer.id, ROAD_MIN_ZOOM, ROAD_MAX_ZOOM);
      const existingFilter = 'filter' in layer ? layer.filter : undefined;
      const parkingAisleFilter = ['!=', ['get', 'class'], 'parking_aisle'];
      const serviceRoadFilter = ['!=', ['get', 'class'], 'service'];
      map.setFilter(layer.id, ['all', ...(existingFilter ? [existingFilter] : []), parkingAisleFilter, serviceRoadFilter, ...(isPath ? [bikeablePathEligibilityFilter] : [])] as any);
      const isContextRoad = isHighway;
      map.setPaintProperty(layer.id, 'line-color', ['case', nonBikeableRoadFeature, '#28161a', isContextRoad, '#333a38', unpavedBikeablePathFeature, '#4f3c2b', cyclewayFeature, '#154644', bikeablePathEligibilityFilter, '#154644', surfaceColor('#2d3331', '#3a2e23')]);
      // Pedestrian-only source layers use a dotted treatment. Keep them hidden
      // in the base map; the discovered GeoJSON overlay will reveal only the
      // pieces the player has actually uncovered.
      map.setPaintProperty(layer.id, 'line-opacity', isPedestrianFootpath ? 0 : 1);
      map.setPaintProperty(layer.id, 'line-width', isMajor ? ['interpolate', ['linear'], ['zoom'], 6, 0.9, 10, 1.1, 14, 4.5, 18, 7] : isPath ? ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 1.2, 14, 2.4, 18, 3] : ['interpolate', ['linear'], ['zoom'], 6, 0.75, 10, 0.95, 14, 3, 18, 4]);
      map.setLayoutProperty(layer.id, 'line-cap', 'round');
      map.setLayoutProperty(layer.id, 'line-join', 'round');
      if (isPedestrianFootpath) map.setPaintProperty(layer.id, 'line-dasharray', [1, 2.5]);
      else if (isCycleway || isGravelPath || isContextRoad) map.setPaintProperty(layer.id, 'line-dasharray', null);
    }
  }
  if (map.getSource('openmaptiles') && !map.getLayer('roam-bikeable-paths')) {
    map.addLayer({
      id: 'roam-bikeable-paths',
      type: 'line',
      minzoom: ROAD_MIN_ZOOM,
      maxzoom: ROAD_MAX_ZOOM,
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: bikeablePathFilter,
      paint: {
        'line-color': ['case', unpavedBikeablePathFeature, '#4f3c2b', cyclewayFeature, '#154644', bikeablePathEligibilityFilter, '#154644', surfaceColor('#2d3331', '#3a2e23')],
        'line-opacity': 1,
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 1.2, 14, 2.4, 18, 3],
      },
    });
  }
  if (import.meta.env.VITE_AREA_CATALOG !== 'false') {
    if (!map.getSource(REGION_BOUNDARIES_SOURCE)) map.addSource(REGION_BOUNDARIES_SOURCE, { type: 'vector', scheme: 'xyz', tiles: [areaTileUrlTemplate()], minzoom: 0, maxzoom: 22, promoteId: { boundaries: 'id' } });
    if (!map.getLayer(REGION_BOUNDARIES_FILL)) map.addLayer({ id: REGION_BOUNDARIES_FILL, type: 'fill', source: REGION_BOUNDARIES_SOURCE, 'source-layer': 'boundaries', layout: { visibility: showRegionProgress ? 'visible' : 'none' }, paint: { 'fill-color': REGION_BOUNDARY_COLOR, 'fill-opacity': 0 } } as any, firstRoadLayer);
    map.setPaintProperty(REGION_BOUNDARIES_FILL, 'fill-color', REGION_BOUNDARY_COLOR);
    map.setPaintProperty(REGION_BOUNDARIES_FILL, 'fill-opacity', 0);
    for (const level of REGION_BOUNDARY_LEVELS) {
      const id = regionBoundaryLineId(level);
      if (!map.getLayer(id)) map.addLayer({ id, type: 'line', source: REGION_BOUNDARIES_SOURCE, 'source-layer': 'boundaries', layout: { visibility: showRegionProgress ? 'visible' : 'none', 'line-cap': 'butt', 'line-join': 'miter' }, paint: { 'line-color': REGION_BOUNDARY_COLOR, 'line-opacity': boundaryLineOpacity(level), 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.65, 12, 0.85, 18, 1] } } as any);
      map.setFilter(id, (level === 9 ? ['==', ['to-number', ['get', 'display_level'], ['to-number', ['get', 'admin_level'], 0]], 9] : ['==', ['to-number', ['get', 'admin_level'], 0], level]) as any);
      map.setPaintProperty(id, 'line-color', REGION_BOUNDARY_COLOR);
      map.setPaintProperty(id, 'line-opacity', boundaryLineOpacity(level) as any);
      map.setPaintProperty(id, 'line-dasharray', null);
      map.setPaintProperty(id, 'line-width', ['interpolate', ['linear'], ['zoom'], 6, 0.65, 12, 0.85, 18, 1]);
    }
    refreshMapBoundaryLevel(map);
  }
  if (!map.getSource(DISCOVERED_SOURCE)) {
    map.addSource(DISCOVERED_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }
  if (!map.getLayer(DISCOVERED_SOURCE)) {
    map.addLayer({
      id: DISCOVERED_SOURCE,
      type: 'line',
      minzoom: ROAD_MIN_ZOOM,
      maxzoom: ROAD_MAX_ZOOM,
      source: DISCOVERED_SOURCE,
      paint: {
        'line-color': ['match', ['get', 'roadType'], 'cycleway', '#2bb8b0', 'unpaved-path', '#d59c67', 'footpath', '#2bb8b0', '#f0eee7'],
        'line-opacity': 0,
        'line-opacity-transition': { duration: 600, delay: 0 },
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 1.2, 15, 1.8, 18, 3],
      },
      layout: { visibility: showDiscovered ? 'visible' : 'none' },
    } as any);
  }
  if (!map.getSource(PLAYER_DISCOVERY_SOURCE)) {
    map.addSource(PLAYER_DISCOVERY_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }
  if (!map.getLayer(PLAYER_DISCOVERY_FILL)) {
    map.addLayer({
      id: PLAYER_DISCOVERY_FILL,
      type: 'fill',
      source: PLAYER_DISCOVERY_SOURCE,
      paint: { 'fill-color': '#2bb8b0', 'fill-opacity': 0.12 },
    } as any, firstRoadLayer);
  }
  if (!map.getLayer(PLAYER_DISCOVERY_LINE)) {
    map.addLayer({
      id: PLAYER_DISCOVERY_LINE,
      type: 'line',
      source: PLAYER_DISCOVERY_SOURCE,
      paint: { 'line-color': '#b9fff7', 'line-opacity': 0.55, 'line-width': 1.5 },
    } as any, firstRoadLayer);
  }
  if (map.getSource('openmaptiles') && !map.getLayer('roam-buildings-3d')) {
    map.addLayer({
      id: 'roam-buildings-3d',
      type: 'fill-extrusion',
      minzoom: 13,
      source: 'openmaptiles',
      'source-layer': 'building',
      paint: {
        'fill-extrusion-color': '#27302e',
        'fill-extrusion-opacity': 0.28,
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 0],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
        'fill-extrusion-vertical-gradient': true,
      },
      layout: { visibility: is3D && showBuildings3D ? 'visible' : 'none' },
    } as any, firstRoadLayer);
  }
  if (map.getSource('openmaptiles') && !map.getLayer('roam-building-footprints')) {
    map.addLayer({
      id: 'roam-building-footprints',
      type: 'fill',
      minzoom: 13,
      source: 'openmaptiles',
      'source-layer': 'building',
      paint: {
        'fill-color': '#27302e',
        'fill-opacity': 0.2,
        'fill-outline-color': '#3b4642',
      },
      layout: { visibility: showBuildingFootprints ? 'visible' : 'none' },
    } as any, firstRoadLayer);
  }
  // Keep transparent extrusions behind every transportation layer. This is
  // especially important with terrain enabled, where MapLibre's 3D render
  // pass can otherwise make an incorrectly anchored extrusion cover roads.
  const roadLayer = map.getStyle().layers?.find((layer: any) => layer.type === 'line' && ('source-layer' in layer ? layer['source-layer'] === 'transportation' : false));
  if (roadLayer && map.getLayer('roam-buildings-3d')) map.moveLayer('roam-buildings-3d', roadLayer.id);
  if (map.getLayer('roam-buildings-3d')) map.setLayoutProperty('roam-buildings-3d', 'visibility', showBuildingExtrusions ? 'visible' : 'none');
  if (map.getLayer('roam-building-footprints')) map.setLayoutProperty('roam-building-footprints', 'visibility', showBuildingFootprints ? 'visible' : 'none');
  if (is3D && showTerrain3D) {
    if (!map.getSource(TERRAIN_SOURCE)) map.addSource(TERRAIN_SOURCE, { type: 'raster-dem', url: TERRAIN_TILEJSON, tileSize: 512, encoding: 'terrarium' } as any);
    if (!map.getSource(HILLSHADE_SOURCE)) map.addSource(HILLSHADE_SOURCE, { type: 'raster-dem', url: TERRAIN_TILEJSON, tileSize: 512, encoding: 'terrarium' } as any);
    map.setSourceTileLodParams(TERRAIN_LOD_LEVELS, TERRAIN_TILE_RATIO, TERRAIN_SOURCE);
    if (!map.getLayer('roam-terrain-hillshade')) {
      map.addLayer({
        id: 'roam-terrain-hillshade',
        type: 'hillshade',
        source: HILLSHADE_SOURCE,
        paint: { 'hillshade-shadow-color': '#071216', 'hillshade-highlight-color': '#30403a', 'hillshade-exaggeration': 0.32 },
        layout: { visibility: 'visible' },
      } as any, firstRoadLayer);
    } else map.setLayoutProperty('roam-terrain-hillshade', 'visibility', 'visible');
    const terrain = map.getTerrain();
    if (!terrain || terrain.source !== TERRAIN_SOURCE || terrain.exaggeration !== TERRAIN_EXAGGERATION) map.setTerrain({ source: TERRAIN_SOURCE, exaggeration: TERRAIN_EXAGGERATION });
  } else {
    if (map.getLayer('roam-terrain-hillshade')) map.setLayoutProperty('roam-terrain-hillshade', 'visibility', 'none');
    if (map.getTerrain()) map.setTerrain(null);
  }
  if (map.getSource('openmaptiles')) {
    if (!map.getLayer('roam-restricted-landuse')) {
      map.addLayer({
        id: 'roam-restricted-landuse',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landuse',
        filter: ['match', ['get', 'class'], ['military'], true, false] as any,
        paint: { 'fill-color': '#241216', 'fill-opacity': 0.94 },
      } as any);
    }
    if (!map.getLayer('roam-restricted-aeroway')) {
      map.addLayer({
        id: 'roam-restricted-aeroway',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'aeroway',
        filter: ['match', ['get', 'class'], ['aerodrome', 'airport'], true, false] as any,
        paint: { 'fill-color': '#241216', 'fill-opacity': 0.94 },
      } as any);
    }
  }
  if (map.getLayer(DISCOVERED_SOURCE)) {
    map.setLayoutProperty(DISCOVERED_SOURCE, 'visibility', showDiscovered ? 'visible' : 'none');
  }
  // Keep the existing generalized overview below z12; use the same filters and
  // paints against complete z14 geometry at useful cycling zooms.
  if (map.getSource(NETWORK_SOURCE)) {
    for (const id of ['roam-bikeable-paths']) {
      const detailId = `${id}-detail`;
      if (!map.getLayer(detailId)) {
        const original = map.getStyle().layers.find((layer: any) => layer.id === id);
        if (original?.type === 'line') {
          map.addLayer({ ...original, id: detailId, source: NETWORK_SOURCE, minzoom: NETWORK_MIN_ZOOM }, id);
          map.setLayerZoomRange(id, ROAD_MIN_ZOOM, NETWORK_MIN_ZOOM);
        }
      }
    }
  }
  if (map.getLayer(REGION_BOUNDARIES_FILL)) map.moveLayer(REGION_BOUNDARIES_FILL);
  for (const id of REGION_BOUNDARIES_LINES) if (map.getLayer(id)) map.moveLayer(id);
  if (map.getLayer(REGION_BOUNDARIES_FILL)) map.setLayoutProperty(REGION_BOUNDARIES_FILL, 'visibility', showRegionProgress ? 'visible' : 'none');
  for (const lineId of REGION_BOUNDARIES_LINES) if (map.getLayer(lineId)) map.setLayoutProperty(lineId, 'visibility', showRegionProgress ? 'visible' : 'none');
  for (const id of [REGION_BOUNDARIES_FILL, CURRENT_AREA_FILL, ...REGION_BOUNDARIES_LINES, CURRENT_AREA_LINE]) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
  // The shared base-map treatment hides any style layer with “boundary” in
  // its id. Reassert catalog visibility after the final layer-order pass so
  // sibling/admin-level features cannot be left hidden behind the active area.
  if (map.getLayer(REGION_BOUNDARIES_FILL)) map.setLayoutProperty(REGION_BOUNDARIES_FILL, 'visibility', showRegionProgress ? 'visible' : 'none');
  for (const lineId of REGION_BOUNDARIES_LINES) if (map.getLayer(lineId)) map.setLayoutProperty(lineId, 'visibility', showRegionProgress ? 'visible' : 'none');
}

function roadTypeForFeature(properties: Record<string, unknown>) {
  return roadTypeForProperties(properties);
}

type NetworkDenominators = { segments: number; lengthMeters: number; byRoadType: Record<string, { segments: number; lengthMeters: number }> };

function progressStatsForDenominator(denominator: NetworkDenominators, discoveries: DiscoveredSegment[]): ProgressStats {
  const discovered = new globalThis.Map<string, DiscoveredSegment>(discoveries.map(segment => [segment.id, segment]));
  const meters = { 'paved-road': 0, cycleway: 0, 'unpaved-path': 0 };
  for (const segment of discovered.values()) {
    // Records stored before the three-category update can contain footpath.
    // Preserve that progress by folding it into the teal cycleway network.
    const roadType = segment.roadType === 'unpaved-path'
      ? 'unpaved-path'
      : segment.roadType === 'cycleway' || (segment.roadType as string) === 'footpath'
        ? 'cycleway'
        : 'paved-road';
    meters[roadType] += segment.lengthMeters;
  }
  const totalDiscoveredMeters = Object.values(meters).reduce((total, value) => total + value, 0);
  const scale = Math.max(denominator.lengthMeters, totalDiscoveredMeters);
  const percentage = (value: number) => scale ? value / scale * 100 : 0;
  return { discovered: percentage(totalDiscoveredMeters), pavedBikeableRoads: percentage(meters['paved-road']), pavedCycleways: percentage(meters.cycleway), unpavedPaths: percentage(meters['unpaved-path']) };
}

function progressStatsForDistrict(districtId: string, discoveries: DiscoveredSegment[]) {
  const denominator = STOCKHOLM_ROAD_NETWORK_BY_DISTRICT.get(districtId)?.denominators;
  return denominator ? progressStatsForDenominator(denominator, discoveries.filter(segment => segment.regionId === districtId)) : CURRENT_PROGRESS;
}

function aggregateDenominators(districtIds: string[]): NetworkDenominators {
  const denominator = { segments: 0, lengthMeters: 0, byRoadType: {} as Record<string, { segments: number; lengthMeters: number }> };
  for (const districtId of districtIds) {
    const district = STOCKHOLM_ROAD_NETWORK_BY_DISTRICT.get(districtId)?.denominators;
    if (!district) continue;
    denominator.segments += district.segments;
    denominator.lengthMeters += district.lengthMeters;
    for (const [roadType, values] of Object.entries(district.byRoadType)) {
      const current = denominator.byRoadType[roadType] ?? { segments: 0, lengthMeters: 0 };
      denominator.byRoadType[roadType] = { segments: current.segments + values.segments, lengthMeters: current.lengthMeters + values.lengthMeters };
    }
  }
  return denominator;
}

function isDiscoverableFeature(properties: Record<string, unknown>) {
  return isDiscoverableProperties(properties);
}

function candidatesFromMap(map: Map, location: PlayerLocation): RoadCandidate[] {
  try {
    const candidates: RoadCandidate[] = [];
    const latitudePadding = DISCOVERY_RADIUS_METERS / 111_320;
    const longitudePadding = DISCOVERY_RADIUS_METERS / (111_320 * Math.cos(location.lat * Math.PI / 180));
    map.querySourceFeatures(NETWORK_SOURCE, { sourceLayer: 'transportation' }).forEach((feature: any) => {
      const properties = feature.properties ?? {};
      if (!isDiscoverableFeature(properties)) return;
      const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : [];
      lines.forEach((coordinates: [number, number][], part: number) => {
        if (coordinates.length < 2) return;
        const lngs = coordinates.map(([lng]) => lng);
        const lats = coordinates.map(([, lat]) => lat);
        if (Math.max(...lngs) < location.lng - longitudePadding || Math.min(...lngs) > location.lng + longitudePadding || Math.max(...lats) < location.lat - latitudePadding || Math.min(...lats) > location.lat + latitudePadding) return;
        const roadType = roadTypeForFeature(properties);
        candidates.push({ id: stableRoadCandidateId(coordinates, roadType, legacyRoadTypeForProperties(properties)), geometry: { type: 'LineString', coordinates }, roadType });
      });
    });
    return candidates;
  } catch {
    return [];
  }
}

function findMapLocality(map: Map, point: { lng: number; lat: number }) {
  const features = map.querySourceFeatures('openmaptiles', { sourceLayer: 'place' });
  const candidates = features
    .filter((feature) => typeof feature.properties?.name === 'string')
    .map((feature) => ({ name: String(feature.properties.name), className: String(feature.properties.class || ''), rank: Number(feature.properties.rank || 99), distance: feature.geometry.type === 'Point' ? Math.hypot((feature.geometry.coordinates[0] as number) - point.lng, (feature.geometry.coordinates[1] as number) - point.lat) : 99 }))
    .sort((a, b) => a.distance - b.distance || a.rank - b.rank);
  const city = candidates.find((candidate) => ['city', 'town', 'village'].includes(candidate.className));
  const region = candidates.find((candidate) => ['suburb', 'neighbourhood', 'quarter', 'district'].includes(candidate.className));
  return { city: city?.name, region: region?.name };
}

function crosshairPixel(map: Map, topInset: number): [number, number] {
  const container = map.getContainer();
  const inset = Math.max(0, Math.min(topInset, container.clientHeight));
  return [container.clientWidth / 2, (container.clientHeight + inset) / 2];
}

function crosshairOffset(map: Map, topInset: number): [number, number] {
  const container = map.getContainer();
  const [x, y] = crosshairPixel(map, topInset);
  return [x - container.clientWidth / 2, y - container.clientHeight / 2];
}

function calculationPointAtCrosshair(map: Map, topInset: number, followPlayer: boolean, playerLocation: PlayerLocation | null) {
  if (followPlayer && playerLocation) return { lng: playerLocation.lng, lat: playerLocation.lat };
  const [x, y] = crosshairPixel(map, topInset);
  return map.unproject([x, y]);
}

function loadCachedMapCenter(): [number, number] | null {
  try {
    const cached = JSON.parse(localStorage.getItem(LAST_MAP_CENTER_STORAGE_KEY) ?? 'null') as { lng?: unknown; lat?: unknown } | null;
    return cached && typeof cached.lng === 'number' && typeof cached.lat === 'number' ? [cached.lng, cached.lat] : null;
  } catch {
    return null;
  }
}

function MapCanvas({ mapRef, viewportBottomInset, crosshairTopInset, showDiscovered, showRegionProgress, progressMode, is3D, showBuildings3D, showTerrain3D, sessionActive, playerLocation, followPlayer, activeRotationFollow, discoveries, onDiscoveries, onLocationChange, onBearingChange, onZoomChange, onPitchChange, onFollowPlayerChange, onMapReady, onVisualReady }: { mapRef: React.MutableRefObject<Map | null>; viewportBottomInset: number; crosshairTopInset: number; showDiscovered: boolean; showRegionProgress: boolean; progressMode: boolean; is3D: boolean; showBuildings3D: boolean; showTerrain3D: boolean; sessionActive: boolean; playerLocation: PlayerLocation | null; followPlayer: boolean; activeRotationFollow: boolean; discoveries: DiscoveredSegment[]; onDiscoveries: (segments: DiscoveredSegment[]) => void; onLocationChange: (lng: number, lat: number, locality?: { city?: string; region?: string }) => void; onBearingChange: (bearing: number) => void; onZoomChange: (zoom: number) => void; onPitchChange: (pitch: number) => void; onFollowPlayerChange: (following: boolean) => void; onMapReady: () => void; onVisualReady: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerMarkerRef = useRef<maplibregl.Marker | null>(null);
  const lastMarkerLocationRef = useRef<PlayerLocation | null>(null);
  const hasCenteredOnFirstLiveLocationRef = useRef(false);
  const followCameraInsetRef = useRef<number | null>(null);
  const wasRecordingRef = useRef(false);
  const recordingCameraPendingRef = useRef(false);
  const markerAnimationFrameRef = useRef<number | null>(null);
  const markerRotationFrameRef = useRef<number | null>(null);
  const markerRotationRef = useRef(0);
  const onFollowPlayerChangeRef = useRef(onFollowPlayerChange);
  const onDiscoveriesRef = useRef(onDiscoveries);
  const cameraFrameRef = useRef<number | null>(null);
  const discoveriesRef = useRef(discoveries);
  const onLocationChangeRef = useRef(onLocationChange);
  const crosshairTopInsetRef = useRef(crosshairTopInset);
  const followPlayerRef = useRef(followPlayer);
  const playerLocationRef = useRef(playerLocation);
  onLocationChangeRef.current = onLocationChange;
  crosshairTopInsetRef.current = crosshairTopInset;
  followPlayerRef.current = followPlayer;
  playerLocationRef.current = playerLocation;
  const initialCenterRef = useRef<[number, number]>(loadCachedMapCenter() ?? [18.0649, 59.3326]);
  const [mapReady, setMapReady] = useState(false);
  const discoveredNetworkRevealedRef = useRef(false);
  const [networkRevision, setNetworkRevision] = useState(0);
  const discoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDiscoveryAttemptRef = useRef(0);
  useEffect(() => { discoveriesRef.current = discoveries; }, [discoveries]);
  useEffect(() => { onFollowPlayerChangeRef.current = onFollowPlayerChange; }, [onFollowPlayerChange]);
  useEffect(() => { onDiscoveriesRef.current = onDiscoveries; }, [onDiscoveries]);
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({ container: containerRef.current, style: MAP_STYLE, center: initialCenterRef.current, zoom: DEFAULT_MAP_ZOOM, pitch: is3D ? DEFAULT_3D_PITCH : 0, bearing: 0, maxPitch: MAX_MAP_PITCH, attributionControl: false, canvasContextAttributes: { antialias: true, powerPreference: 'high-performance' } });
    mapRef.current = map;
    let removeNetworkProtocol = () => {};
    const reportCalculationPoint = () => {
      const point = calculationPointAtCrosshair(map, crosshairTopInsetRef.current, followPlayerRef.current, playerLocationRef.current);
      onLocationChangeRef.current(point.lng, point.lat, findMapLocality(map, point));
    };
    map.on('load', () => {
      removeNetworkProtocol = installNetworkSource(map);
      styleRoamMap(map, showDiscovered, showRegionProgress, progressMode, is3D, showBuildings3D, showTerrain3D);
      reportCalculationPoint();
      onBearingChange(map.getBearing());
      onZoomChange(map.getZoom());
      onPitchChange(map.getPitch());
      setMapReady(true);
      onMapReady();
    });
    // Camera events fire once per animation frame while a gesture/animation is
    // active. Coalesce them so the React controls do not rerender in lockstep
    // with MapLibre's renderer.
    const scheduleCameraState = () => {
      if (cameraFrameRef.current !== null) return;
      cameraFrameRef.current = requestAnimationFrame(() => {
        cameraFrameRef.current = null;
        onBearingChange(map.getBearing());
        onZoomChange(map.getZoom());
        onPitchChange(map.getPitch());
      });
    };
    map.on('rotate', scheduleCameraState);
    map.on('zoom', scheduleCameraState);
    map.on('pitch', scheduleCameraState);
    map.on('zoomend', () => refreshMapBoundaryLevel(map));
    map.on('moveend', reportCalculationPoint);
    map.on('idle', () => setNetworkRevision(revision => revision + 1));
    const stopFollowingForGesture = () => onFollowPlayerChangeRef.current(false);
    const stopFollowingForUserEvent = (event: any) => { if (event.originalEvent) stopFollowingForGesture(); };
    map.on('dragstart', stopFollowingForGesture);
    map.on('rotatestart', stopFollowingForUserEvent);
    map.on('pitchstart', stopFollowingForUserEvent);
    map.on('zoomstart', (event: any) => { if (event.originalEvent) stopFollowingForGesture(); });
    return () => { if (markerAnimationFrameRef.current !== null) cancelAnimationFrame(markerAnimationFrameRef.current); if (markerRotationFrameRef.current !== null) cancelAnimationFrame(markerRotationFrameRef.current); if (cameraFrameRef.current !== null) cancelAnimationFrame(cameraFrameRef.current); playerMarkerRef.current?.remove(); playerMarkerRef.current = null; map.remove(); removeNetworkProtocol(); mapRef.current = null; };
  }, [mapRef]);
  useEffect(() => {
    if (mapReady && mapRef.current) styleRoamMap(mapRef.current, showDiscovered, showRegionProgress, progressMode, is3D, showBuildings3D, showTerrain3D);
  }, [mapReady, mapRef, showDiscovered, showRegionProgress, progressMode, is3D, showBuildings3D, showTerrain3D]);
  useEffect(() => {
    if (mapReady && mapRef.current) {
      mapRef.current.easeTo({ pitch: is3D ? DEFAULT_3D_PITCH : 0, duration: 450 });
    }
  }, [mapReady, mapRef, is3D]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    // Until a live fix or user gesture takes over, keep the cached startup
    // location under the same usable-area center as the crosshair.
    if (followPlayer && !playerLocation && !sessionActive && !hasCenteredOnFirstLiveLocationRef.current) {
      map.easeTo({ center: initialCenterRef.current, offset: crosshairOffset(map, crosshairTopInset), duration: 0 });
    }
    const point = calculationPointAtCrosshair(map, crosshairTopInset, followPlayer, playerLocation);
    onLocationChangeRef.current(point.lng, point.lat, findMapLocality(map, point));
  }, [crosshairTopInset, followPlayer, mapReady, mapRef, playerLocation, sessionActive]);
  useEffect(() => {
    if (!mapReady) return;
    mapRef.current?.resize();
  }, [mapReady, mapRef, viewportBottomInset]);
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const source = map.getSource(DISCOVERED_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const data = { type: 'FeatureCollection', features: discoveries.map(segment => ({ type: 'Feature', properties: { roadType: segment.roadType }, geometry: segment.geometry })) } as const;
    if (discoveredNetworkRevealedRef.current || discoveries.length === 0) {
      source.setData(data as any);
      return;
    }
    let active = true;
    let frame = 0;
    // Wait for GeoJSON processing and a transparent frame before fading in.
    void source.setData(data as any, true).then(() => {
      if (!active) return;
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (!active || !map.getLayer(DISCOVERED_SOURCE)) return;
          if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            map.setPaintProperty(DISCOVERED_SOURCE, 'line-opacity-transition', { duration: 0 });
          }
          discoveredNetworkRevealedRef.current = true;
          map.setPaintProperty(DISCOVERED_SOURCE, 'line-opacity', 1);
        });
      });
    }).catch(() => {});
    return () => { active = false; cancelAnimationFrame(frame); };
  }, [discoveries, mapReady, mapRef]);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    let done = false;
    const reveal = () => { if (!done) { done = true; onVisualReady(); } };
    map.once('render', reveal);
    map.triggerRepaint();
    // Slow tiles should not hold the UI after the map style has loaded.
    const fallback = window.setTimeout(reveal, 1500);
    return () => { done = true; map.off('render', reveal); clearTimeout(fallback); };
  }, [mapReady, mapRef, onVisualReady]);
  useEffect(() => {
    if (!mapReady || !mapRef.current || !playerLocation) return;
    if (discoveryTimeoutRef.current !== null) clearTimeout(discoveryTimeoutRef.current);
    // `idle` can fire repeatedly while a pan brings several tile batches in.
    // Debounce the scan and enforce a small floor between scans; the GPS watch
    // still supplies the authoritative sample every few seconds.
    discoveryTimeoutRef.current = setTimeout(() => {
      discoveryTimeoutRef.current = null;
      const now = Date.now();
      if (now - lastDiscoveryAttemptRef.current < 750) return;
      lastDiscoveryAttemptRef.current = now;
      const map = mapRef.current;
      if (!map) return;
      const district = findStockholmDistrict([playerLocation.lng, playerLocation.lat]);
      const newlyDiscovered = discoverSegments(playerLocation, candidatesFromMap(map, playerLocation), new Set(discoveriesRef.current.map(segment => segment.id)), district);
      if (!newlyDiscovered.length) return;
      discoveriesRef.current = [...discoveriesRef.current, ...newlyDiscovered];
      onDiscoveriesRef.current(newlyDiscovered);
    }, 120);
    return () => { if (discoveryTimeoutRef.current !== null) { clearTimeout(discoveryTimeoutRef.current); discoveryTimeoutRef.current = null; } };
  }, [mapReady, mapRef, networkRevision, playerLocation]);
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (sessionActive !== wasRecordingRef.current) {
      recordingCameraPendingRef.current = sessionActive;
      wasRecordingRef.current = sessionActive;
    }
    const recordingCameraReady = recordingCameraPendingRef.current && is3D && followPlayer && activeRotationFollow;
    const source = mapRef.current.getSource(PLAYER_DISCOVERY_SOURCE) as maplibregl.GeoJSONSource | undefined;
    const setMarkerPosition = (marker: maplibregl.Marker, lng: number, lat: number) => {
      marker.setLngLat([lng, lat]);
      source?.setData(circle([lng, lat], DISCOVERY_RADIUS_METERS, { units: 'meters', steps: 24 }) as any);
    };
    if (!playerLocation) {
      if (markerAnimationFrameRef.current !== null) cancelAnimationFrame(markerAnimationFrameRef.current);
      if (markerRotationFrameRef.current !== null) cancelAnimationFrame(markerRotationFrameRef.current);
      markerAnimationFrameRef.current = null;
      markerRotationFrameRef.current = null;
      markerRotationRef.current = 0;
      playerMarkerRef.current?.remove();
      playerMarkerRef.current = null;
      lastMarkerLocationRef.current = null;
      source?.setData({ type: 'FeatureCollection', features: [] });
      if (recordingCameraReady) {
        mapRef.current.easeTo({ zoom: RECORDING_MAP_ZOOM, pitch: DEFAULT_3D_PITCH, duration: 850 });
        recordingCameraPendingRef.current = false;
      }
      return;
    }
    let markerWasCreated = false;
    if (!playerMarkerRef.current) {
      const element = document.createElement('div');
      element.className = 'player-marker';
      element.setAttribute('aria-label', 'Your current location');
      element.innerHTML = '<svg class="player-marker__arrow" viewBox="0 0 32 40" aria-hidden="true"><path d="M16 1 31 35 16 29 1 35Z" /></svg>';
      // addTo immediately projects the marker, so coordinates must exist first.
      playerMarkerRef.current = new maplibregl.Marker({ element, anchor: 'center', rotationAlignment: 'map', pitchAlignment: 'map' })
        .setLngLat([playerLocation.lng, playerLocation.lat])
        .addTo(mapRef.current);
      source?.setData(circle([playerLocation.lng, playerLocation.lat], DISCOVERY_RADIUS_METERS, { units: 'meters', steps: 24 }) as any);
      markerWasCreated = true;
    }
    const marker = playerMarkerRef.current;
    if (!markerWasCreated && lastMarkerLocationRef.current !== playerLocation) {
      if (markerAnimationFrameRef.current !== null) cancelAnimationFrame(markerAnimationFrameRef.current);
      const start = marker.getLngLat();
      const destination: [number, number] = [playerLocation.lng, playerLocation.lat];
      const startedAt = performance.now();
      const animateMarker = (now: number) => {
        const progress = Math.min((now - startedAt) / (followPlayer ? 850 : 650), 1);
        const eased = 1 - (1 - progress) ** 3;
        setMarkerPosition(marker, start.lng + (destination[0] - start.lng) * eased, start.lat + (destination[1] - start.lat) * eased);
        if (progress < 1) markerAnimationFrameRef.current = requestAnimationFrame(animateMarker);
        else markerAnimationFrameRef.current = null;
      };
      markerAnimationFrameRef.current = requestAnimationFrame(animateMarker);
    }
    lastMarkerLocationRef.current = playerLocation;
    const targetRotation = playerLocation.travelHeading ?? 0;
    if (markerWasCreated) {
      markerRotationRef.current = targetRotation;
      marker.setRotation(targetRotation);
    } else {
      if (markerRotationFrameRef.current !== null) cancelAnimationFrame(markerRotationFrameRef.current);
      const startRotation = markerRotationRef.current;
      const shortestTurn = ((targetRotation - startRotation + 540) % 360) - 180;
      const finalRotation = startRotation + shortestTurn;
      const startedAt = performance.now();
      const animateRotation = (now: number) => {
        const progress = Math.min((now - startedAt) / 500, 1);
        const eased = 1 - (1 - progress) ** 3;
        const rotation = startRotation + (finalRotation - startRotation) * eased;
        markerRotationRef.current = rotation;
        marker.setRotation(rotation);
        if (progress < 1) markerRotationFrameRef.current = requestAnimationFrame(animateRotation);
        else markerRotationFrameRef.current = null;
      };
      markerRotationFrameRef.current = requestAnimationFrame(animateRotation);
    }
    marker.getElement().classList.toggle('player-marker--recording', sessionActive);
    if (recordingCameraPendingRef.current && !recordingCameraReady) return;
    if (followPlayer) {
      const map = mapRef.current;
      const camera = {
        center: [playerLocation.lng, playerLocation.lat] as [number, number],
        offset: crosshairOffset(map, crosshairTopInset),
        // A GPS update can arrive during the 2D/3D animation. Carry its target
        // pitch into the new camera movement so the transition still finishes.
        pitch: is3D ? DEFAULT_3D_PITCH : 0,
        ...(!activeRotationFollow ? { bearing: 0 } : playerLocation.isMoving && playerLocation.travelHeading !== null ? { bearing: playerLocation.travelHeading } : {}),
      };
      const firstFix = !hasCenteredOnFirstLiveLocationRef.current;
      const actionableAreaChanged = followCameraInsetRef.current !== null && followCameraInsetRef.current !== crosshairTopInset;
      if (!sessionActive && (firstFix || actionableAreaChanged)) map.easeTo({ ...camera, duration: 0 });
      else map.easeTo({ ...camera, ...(recordingCameraReady ? { zoom: RECORDING_MAP_ZOOM } : {}), duration: 850, easing: progress => 1 - (1 - progress) ** 3 });
      hasCenteredOnFirstLiveLocationRef.current = true;
      followCameraInsetRef.current = crosshairTopInset;
      recordingCameraPendingRef.current = false;
    }
  }, [activeRotationFollow, crosshairTopInset, followPlayer, is3D, mapReady, mapRef, playerLocation, sessionActive]);
  return <div className="map-canvas" style={{ bottom: viewportBottomInset }}><div ref={containerRef} className={mapReady ? 'maplibre-container maplibre-container--ready' : 'maplibre-container'} /><div className={is3D ? 'map-depth-fade' : 'map-depth-fade map-depth-fade--hidden'} aria-hidden="true" />
  </div>;
}

function MapView({ active, onRequestLocation, sessionActive, onSessionChange, activityDrawerHeight, showDiscovered, showRegionProgress, setShowRegionProgress, is3D, setIs3D, showBuildings3D, setShowBuildings3D, showTerrain3D, setShowTerrain3D, showDebugMenu, playerLocation, discoveries, discoveriesLoaded, initialSyncSettled, onDiscoveries }: { active: boolean; onRequestLocation: () => void; sessionActive: boolean; onSessionChange: (active: boolean) => void; activityDrawerHeight: number; showDiscovered: boolean; showRegionProgress: boolean; setShowRegionProgress: (value: boolean) => void; is3D: boolean; setIs3D: (value: boolean) => void; showBuildings3D: boolean; setShowBuildings3D: (value: boolean) => void; showTerrain3D: boolean; setShowTerrain3D: (value: boolean) => void; showDebugMenu: boolean; playerLocation: PlayerLocation | null; discoveries: DiscoveredSegment[]; discoveriesLoaded: boolean; initialSyncSettled: boolean; onDiscoveries: (segments: DiscoveredSegment[]) => void }) {
  const [bearing, setBearing] = useState(0);
  const [followPlayer, setFollowPlayer] = useState(true);
  const [activeRotationFollow, setActiveRotationFollow] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [progressMode, setProgressMode] = useState(false);
  const [progressMapReady, setProgressMapReady] = useState(false);
  const [mapVisualReady, setMapVisualReady] = useState(false);
  const [startupDismissed, setStartupDismissed] = useState(false);
  const [startupCenterSettled, setStartupCenterSettled] = useState(false);
  const [topOverlayInset, setTopOverlayInset] = useState(0);
  const measuredStartupViewportRef = useRef<string | null>(null);
  const [location, setLocation] = useState<LocationState>(DEFAULT_LOCATION);
  const [currentArea, setCurrentArea] = useState<AreaRecord | null>(null);
  const [currentParentAreaName, setCurrentParentAreaName] = useState<string | null>(null);
  const [selectedProgressArea, setSelectedProgressArea] = useState<AreaRecord | null>(null);
  const [selectedParentAreaName, setSelectedParentAreaName] = useState<string | null>(null);
  const [visibleBadgeAreas, setVisibleBadgeAreas] = useState<{ id: string; name: string; point: [number, number] }[]>([]);
  const [regionBadgeData, setRegionBadgeData] = useState<Record<string, { point: [number, number]; percentage: number | null; loading: boolean }>>({});
  const mapRef = useRef<Map | null>(null);
  const mapViewRef = useRef<HTMLElement | null>(null);
  const mapHeaderRef = useRef<HTMLElement | null>(null);
  const progressCardRef = useRef<HTMLDivElement | null>(null);
  const progressMarkersRef = useRef(new globalThis.Map<string, { marker: maplibregl.Marker; button: HTMLButtonElement }>());
  const progressAreaControllerRef = useRef<AbortController | null>(null);
  const pendingProgressFitRef = useRef(false);
  const previousSessionActiveRef = useRef(false);
  const wakeLockStatus = useScreenWakeLock(sessionActive);
  const onMapReady = useCallback(() => setProgressMapReady(true), []);
  const onVisualReady = useCallback(() => setMapVisualReady(true), []);
  useEffect(() => {
    if (!mapVisualReady) return;
    const timer = window.setTimeout(() => setStartupDismissed(true), 450);
    return () => clearTimeout(timer);
  }, [mapVisualReady]);
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => mapRef.current?.resize());
    return () => cancelAnimationFrame(frame);
  }, [active]);
  useEffect(() => { if (!playerLocation && !sessionActive) setActiveRotationFollow(false); }, [playerLocation, sessionActive]);
  useEffect(() => {
    if (previousSessionActiveRef.current === sessionActive) return;
    previousSessionActiveRef.current = sessionActive;
    if (sessionActive) {
      progressAreaControllerRef.current?.abort();
      pendingProgressFitRef.current = false;
      setProgressMode(false);
      setFollowPlayer(true);
      setActiveRotationFollow(true);
      setIs3D(true);
    } else {
      setActiveRotationFollow(false);
      setIs3D(false);
      mapRef.current?.jumpTo({ bearing: 0 });
    }
  }, [sessionActive, setIs3D]);
  const handleLocationChange = (lng: number, lat: number, locality?: { city?: string; region?: string }) => {
    const district = findStockholmDistrict([lng, lat]);
    setLocation(current => ({ ...current, lng, lat, city: locality?.city?.toUpperCase() || current.city, region: district?.name.toUpperCase() ?? '' }));
  };
  const handleBearingChange = (nextBearing: number) => setBearing((previousBearing) => {
    let adjustedBearing = nextBearing;
    while (adjustedBearing - previousBearing > 180) adjustedBearing -= 360;
    while (adjustedBearing - previousBearing < -180) adjustedBearing += 360;
    return adjustedBearing;
  });
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void lookupAreas(location.lng, location.lat, controller.signal).then(async ({ areas }) => {
        const candidate = areas
          .filter(record => record.area.adminLevel >= 7 && record.area.adminLevel <= 9)
          .sort((left, right) => right.area.adminLevel - left.area.adminLevel)[0];
        if (!candidate) {
          setCurrentArea(null);
          setCurrentParentAreaName(null);
          return;
        }
        const parentArea = areas
          .filter(record => record.area.countryCode === candidate.area.countryCode && record.area.adminLevel >= 4 && record.area.adminLevel < candidate.area.adminLevel)
          .sort((left, right) => right.area.adminLevel - left.area.adminLevel)[0];
        if (controller.signal.aborted) return;
        setCurrentParentAreaName(parentArea?.area.name ?? null);
        const cached = mapAreaCache.get(candidate.area.id);
        if (cached?.area.boundaryVersion === candidate.area.boundaryVersion) {
          const record = { ...cached, job: candidate.job };
          mapAreaCache.set(record.area.id, record);
          setCurrentArea(record);
          return;
        }
        // Lookup already includes the region name and backend road total.
        // Show those immediately while the separate boundary request finishes.
        setCurrentArea(candidate);
        const record = await loadArea(candidate.area.id, controller.signal, true);
        if (controller.signal.aborted) return;
        mapAreaCache.set(record.area.id, record);
        setCurrentArea(record);
      }).catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      });
    }, 350);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [location.lat, location.lng]);
  const updateCurrentArea = useCallback((record: AreaRecord) => {
    mapAreaCache.set(record.area.id, record);
    setCurrentArea(current => current?.area.id === record.area.id ? record : current);
    setSelectedProgressArea(current => current?.area.id === record.area.id ? record : current);
  }, []);
  const fitAreaInProgressMode = useCallback((record: AreaRecord) => {
    if (!record.area.geometry || !mapRef.current) return;
    const [west, south, east, north] = bbox(record.area.geometry as any);
    const measuredTopInset = mapHeaderRef.current && mapViewRef.current
      ? Math.max(0, mapHeaderRef.current.getBoundingClientRect().bottom - mapViewRef.current.getBoundingClientRect().top)
      : topOverlayInset;
    mapRef.current.fitBounds([[west, south], [east, north]], {
      padding: { top: Math.ceil(measuredTopInset + 20), right: 24, bottom: 24, left: 24 },
      pitch: 0,
      maxZoom: 13.5,
      duration: 650,
    });
  }, [topOverlayInset]);
  const focusAreaById = useCallback((id: string) => {
    progressAreaControllerRef.current?.abort();
    const controller = new AbortController();
    progressAreaControllerRef.current = controller;
    void (async () => {
      try {
        const record = mapAreaCache.get(id) ?? await loadArea(id, controller.signal, true);
        if (controller.signal.aborted) return;
        mapAreaCache.set(record.area.id, record);
        setSelectedProgressArea(record);
        fitAreaInProgressMode(record);
        if (record.area.geometry) {
          const point = pointOnFeature({ type: 'Feature', properties: {}, geometry: record.area.geometry } as any).geometry.coordinates;
          const { areas } = await lookupAreas(point[0], point[1], controller.signal);
          if (!controller.signal.aborted) {
            const parent = areas.filter(area => area.area.countryCode === record.area.countryCode && area.area.adminLevel >= 4 && area.area.adminLevel < record.area.adminLevel).sort((left, right) => right.area.adminLevel - left.area.adminLevel)[0];
            setSelectedParentAreaName(parent?.area.name ?? null);
          }
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) console.warn('Could not open region progress:', error);
      }
    })();
  }, [fitAreaInProgressMode]);
  const focusAreaAt = useCallback((lng: number, lat: number) => {
    progressAreaControllerRef.current?.abort();
    const controller = new AbortController();
    progressAreaControllerRef.current = controller;
    void lookupAreas(lng, lat, controller.signal).then(({ areas }) => {
      const candidate = areas
        .filter(record => record.area.adminLevel >= 7 && record.area.adminLevel <= 9)
        .sort((left, right) => right.area.adminLevel - left.area.adminLevel)[0];
      if (candidate && !controller.signal.aborted) focusAreaById(candidate.area.id);
    }).catch(error => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) console.warn('Could not find a region here:', error);
    });
  }, [focusAreaById]);
  useLayoutEffect(() => {
    const header = mapHeaderRef.current;
    const view = mapViewRef.current;
    if (!header || !view) return;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const updateInset = () => {
      const card = progressCardRef.current;
      const viewBounds = view.getBoundingClientRect();
      const viewTop = viewBounds.top;
      // The mounted card reserves the same safe-area-adjusted space while
      // loading and after its progress content appears.
      const top = card ? card.getBoundingClientRect().bottom - viewTop
        : header.getBoundingClientRect().top - viewTop + parseFloat(getComputedStyle(header).paddingTop);
      const inset = Math.max(0, Math.ceil(top));
      const viewport = `${inset}:${Math.round(viewBounds.width)}:${Math.round(viewBounds.left)}`;
      if (measuredStartupViewportRef.current === viewport) return;
      measuredStartupViewportRef.current = viewport;
      setTopOverlayInset(inset);
      if (settleTimer) clearTimeout(settleTimer);
      setStartupCenterSettled(false);
      settleTimer = setTimeout(() => setStartupCenterSettled(true), 120);
    };
    updateInset();
    const observer = new ResizeObserver(updateInset);
    observer.observe(view);
    observer.observe(header);
    if (progressCardRef.current) observer.observe(progressCardRef.current);
    window.addEventListener('resize', updateInset);
    return () => { observer.disconnect(); window.removeEventListener('resize', updateInset); if (settleTimer) clearTimeout(settleTimer); };
  }, []);
  useEffect(() => {
    if (progressMode && pendingProgressFitRef.current && currentArea?.area.geometry && progressMapReady) {
      pendingProgressFitRef.current = false;
      fitAreaInProgressMode(currentArea);
    }
  }, [currentArea, fitAreaInProgressMode, progressMapReady, progressMode]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !progressMapReady || !progressMode) return;
    const onRegionClick = (event: maplibregl.MapLayerMouseEvent) => {
      const features = map.queryRenderedFeatures(event.point, { layers: [REGION_BOUNDARIES_FILL] });
      const areaId = features
        .sort((left, right) => Number(right.properties?.admin_level ?? 0) - Number(left.properties?.admin_level ?? 0))
        .map(feature => String(feature.properties?.id ?? ''))
        .find(id => id.startsWith('relation/'));
      if (areaId) focusAreaById(areaId);
    };
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };
    map.on('click', REGION_BOUNDARIES_FILL, onRegionClick);
    map.on('mouseenter', REGION_BOUNDARIES_FILL, onEnter);
    map.on('mouseleave', REGION_BOUNDARIES_FILL, onLeave);
    return () => {
      map.off('click', REGION_BOUNDARIES_FILL, onRegionClick);
      map.off('mouseenter', REGION_BOUNDARIES_FILL, onEnter);
      map.off('mouseleave', REGION_BOUNDARIES_FILL, onLeave);
      map.getCanvas().style.cursor = '';
    };
  }, [focusAreaById, progressMapReady, progressMode]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !progressMapReady || !progressMode) { setVisibleBadgeAreas([]); return; }
    let timer: number | undefined;
    const update = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!map.getLayer(REGION_BOUNDARIES_FILL)) return;
        const level = mapBoundaryLevel(map.getZoom());
        const areas = new globalThis.Map<string, { id: string; name: string; point: [number, number]; size: number }>();
        for (const feature of map.queryRenderedFeatures({ layers: [REGION_BOUNDARIES_FILL] })) {
          const properties = feature.properties as Record<string, unknown> | null;
          if (!properties || !boundaryMatchesLevel(properties, level)) continue;
          const id = String(properties.id ?? '');
          if (!id.startsWith('relation/') || (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon')) continue;
          const size = area(feature as any);
          if (size > (areas.get(id)?.size ?? -1)) {
            const fullGeometry = mapAreaCache.get(id)?.area.geometry;
            areas.set(id, { id, name: displayAreaName(String(properties.name ?? 'Area'), level), point: areaLabelPoint(fullGeometry ?? feature.geometry as any), size });
          }
        }
        const next = [...areas.values()].map(({ size: _size, ...visible }) => visible).sort((a, b) => a.id.localeCompare(b.id));
        setVisibleBadgeAreas(previous => previous.length === next.length && previous.every((value, index) => value.id === next[index].id) ? previous : next);
      }, 80);
    };
    map.on('idle', update);
    map.on('moveend', update);
    update();
    return () => { window.clearTimeout(timer); map.off('idle', update); map.off('moveend', update); };
  }, [progressMapReady, progressMode]);
  useEffect(() => {
    if (!progressMode || !visibleBadgeAreas.length) return;
    const controller = new AbortController();
    setRegionBadgeData(previous => {
      const next = { ...previous };
      for (const visible of visibleBadgeAreas) {
        const percentage = previous[visible.id]?.percentage ?? null;
        next[visible.id] = { point: previous[visible.id]?.point ?? visible.point, percentage, loading: percentage === null };
      }
      return next;
    });
    for (const visible of visibleBadgeAreas) {
      void (async () => {
        try {
          const record = mapAreaCache.get(visible.id) ?? await loadArea(visible.id, controller.signal, true);
          if (controller.signal.aborted || !record.area.geometry) return;
          mapAreaCache.set(record.area.id, record);
          const point = areaLabelPoint(record.area.geometry);
          const ready = record.job?.status === 'ready' ? record.job.totals : null;
          if (!ready || ready.lengthMeters <= 0) {
            setRegionBadgeData(previous => ({ ...previous, [visible.id]: { point, percentage: null, loading: false } }));
            return;
          }
          const areaKey = `${record.area.id}:${record.area.boundaryVersion}`;
          const key = exploredTotalsKey(discoveries, areaKey, record.area.geometry);
          const cached = cachedExploredTotals(key, areaKey);
          if (cached) {
            const rawPercentage = cached.lengthMeters / ready.lengthMeters * 100;
            setRegionBadgeData(previous => ({ ...previous, [visible.id]: { point, percentage: rawPercentage <= 100.1 ? Math.min(100, rawPercentage) : null, loading: false } }));
            return;
          }
          setRegionBadgeData(previous => ({ ...previous, [visible.id]: { point, percentage: previous[visible.id]?.percentage ?? null, loading: true } }));
          const totals = await calculateExploredAreaTotals(discoveries, record.area.geometry, key, areaKey);
          if (controller.signal.aborted) return;
          const rawPercentage = totals.lengthMeters / ready.lengthMeters * 100;
          setRegionBadgeData(previous => ({ ...previous, [visible.id]: { point, percentage: rawPercentage <= 100.1 ? Math.min(100, rawPercentage) : null, loading: false } }));
        } catch (error) {
          if (!(error instanceof DOMException && error.name === 'AbortError')) {
            console.warn(`Could not calculate ${visible.name} progress:`, error);
            setRegionBadgeData(previous => ({ ...previous, [visible.id]: { point: previous[visible.id]?.point ?? visible.point, percentage: previous[visible.id]?.percentage ?? null, loading: false } }));
          }
        }
      })();
    }
    return () => controller.abort();
  }, [discoveries, progressMode, visibleBadgeAreas]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !progressMapReady) return;
    const entries = progressMarkersRef.current;
    const activeIds = new Set(progressMode ? visibleBadgeAreas.map(visible => visible.id) : []);
    for (const visible of progressMode ? visibleBadgeAreas : []) {
      const badge = regionBadgeData[visible.id];
      const percentage = badge?.percentage === null || badge?.percentage === undefined ? '—' : `${badge.percentage.toFixed(1)}%`;
      let entry = entries.get(visible.id);
      if (!entry) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'progress-region-badge';
        button.addEventListener('pointerdown', event => event.stopPropagation());
        const marker = new maplibregl.Marker({ element: button, anchor: 'center' }).setLngLat(badge?.point ?? visible.point).addTo(map);
        entry = { marker, button };
        entries.set(visible.id, entry);
      }
      entry.marker.setLngLat(badge?.point ?? visible.point);
      entry.button.textContent = percentage;
      entry.button.classList.toggle('progress-region-badge--current', visible.id === (selectedProgressArea ?? currentArea)?.area.id);
      entry.button.classList.toggle('progress-region-badge--loading', badge?.loading === true);
      entry.button.setAttribute('aria-label', `${visible.name}, ${percentage === '—' ? badge?.loading === false ? 'progress unavailable' : 'calculating progress' : `${percentage} explored${badge?.loading ? ', updating' : ''}`}. Focus region`);
      entry.button.onclick = event => { event.stopPropagation(); focusAreaById(visible.id); };
    }
    for (const [id, entry] of entries) {
      if (activeIds.has(id)) continue;
      entry.marker.remove();
      entries.delete(id);
    }
  }, [currentArea, focusAreaById, progressMapReady, progressMode, regionBadgeData, selectedProgressArea, visibleBadgeAreas]);
  useEffect(() => () => {
    for (const entry of progressMarkersRef.current.values()) {
      entry.marker.remove();
    }
    progressMarkersRef.current.clear();
  }, []);
  const displayedArea = progressMode ? selectedProgressArea ?? currentArea : currentArea;
  const displayedParentAreaName = progressMode ? selectedParentAreaName : currentParentAreaName;
  useEffect(() => {
    if (displayedArea?.job?.status !== 'queued' && displayedArea?.job?.status !== 'running') return;
    const controller = new AbortController();
    let busy = false;
    const timer = window.setInterval(() => {
      if (busy) return;
      busy = true;
      void loadArea(displayedArea.area.id, controller.signal, true).then(record => {
        if (!controller.signal.aborted) updateCurrentArea(record);
      }).catch(error => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) console.warn('Could not refresh area coverage:', error);
      }).finally(() => { busy = false; });
    }, 3000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [displayedArea?.area.id, displayedArea?.job?.status, updateCurrentArea]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!displayedArea?.area.geometry) {
      for (const id of [CURRENT_AREA_FILL, CURRENT_AREA_LINE]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
      return;
    }
    if (!map.getSource(CURRENT_AREA_SOURCE)) map.addSource(CURRENT_AREA_SOURCE, { type: 'geojson', data: displayedArea.area.geometry as any });
    else (map.getSource(CURRENT_AREA_SOURCE) as maplibregl.GeoJSONSource).setData(displayedArea.area.geometry as any);
    if (!map.getLayer(CURRENT_AREA_FILL)) map.addLayer({ id: CURRENT_AREA_FILL, type: 'fill', source: CURRENT_AREA_SOURCE, paint: { 'fill-color': REGION_BOUNDARY_COLOR, 'fill-opacity': 0.11 } } as any);
    if (!map.getLayer(CURRENT_AREA_LINE)) map.addLayer({ id: CURRENT_AREA_LINE, type: 'line', source: CURRENT_AREA_SOURCE, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': REGION_BOUNDARY_COLOR, 'line-opacity': 1, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.4, 12, 1.8, 18, 2.2] } } as any);
    map.setPaintProperty(CURRENT_AREA_FILL, 'fill-color', REGION_BOUNDARY_COLOR);
    map.setPaintProperty(CURRENT_AREA_LINE, 'line-color', REGION_BOUNDARY_COLOR);
    map.setPaintProperty(CURRENT_AREA_LINE, 'line-dasharray', null);
    const updateVisibility = () => {
      const level = mapBoundaryLevel(map.getZoom());
      const promotedMunicipality = level === 9 && displayedArea.area.adminLevel === 7 && map.queryRenderedFeatures({ layers: [REGION_BOUNDARIES_FILL] }).some(feature => String(feature.properties?.id) === displayedArea.area.id && boundaryMatchesLevel(feature.properties as Record<string, unknown>, 9));
      const visible = progressMode && (displayedArea.area.adminLevel === level || promotedMunicipality);
      map.setLayoutProperty(CURRENT_AREA_FILL, 'visibility', visible ? 'visible' : 'none');
      map.setLayoutProperty(CURRENT_AREA_LINE, 'visibility', visible ? 'visible' : 'none');
    };
    updateVisibility();
    map.on('zoomend', updateVisibility);
    map.on('idle', updateVisibility);
    for (const id of [REGION_BOUNDARIES_FILL, CURRENT_AREA_FILL, ...REGION_BOUNDARIES_LINES, CURRENT_AREA_LINE]) {
      if (map.getLayer(id)) map.moveLayer(id);
    }
    return () => { map.off('zoomend', updateVisibility); map.off('idle', updateVisibility); };
  }, [displayedArea, progressMode]);
  useEffect(() => { mapRef.current?.resize(); }, [activityDrawerHeight]);
  const sessionDockOffset = sessionActive ? 'var(--spacing-map-edge)' : 'calc(var(--spacing-map-edge) + 44px + var(--map-control-gap))';
  const centerOnPlayer = () => {
    if (progressMode) {
      setProgressMode(false);
      pendingProgressFitRef.current = false;
      progressAreaControllerRef.current?.abort();
    }
    if (!playerLocation) {
      setFollowPlayer(true);
      setActiveRotationFollow(false);
      onRequestLocation();
      return;
    }
    if (!followPlayer) {
      setFollowPlayer(true);
      return;
    }
    if (!activeRotationFollow) {
      setActiveRotationFollow(true);
      if (mapRef.current) mapRef.current.easeTo({ center: [playerLocation.lng, playerLocation.lat], offset: crosshairOffset(mapRef.current, topOverlayInset), ...(playerLocation.isMoving && playerLocation.travelHeading !== null ? { bearing: playerLocation.travelHeading } : {}), duration: 850 });
      return;
    }
    setActiveRotationFollow(false);
  };
  const isFollowingPlayer = !progressMode && followPlayer && Boolean(playerLocation);
  const handleFollowChange = (following: boolean) => { setFollowPlayer(following); if (!following) setActiveRotationFollow(false); };
  const resetCompass = () => { setActiveRotationFollow(false); mapRef.current?.easeTo({ bearing: 0, duration: 450 }); };
  const normalizedBearing = (bearing % 360 + 360) % 360;
  const compassVisible = Math.min(normalizedBearing, 360 - normalizedBearing) > 1;
  const locationControlClass = `map-ui-surface location-control${isFollowingPlayer ? ' location-control--following' : ''}${activeRotationFollow ? ' location-control--active' : ''}`;
  const locationControlLabel = activeRotationFollow ? 'Following your location and heading' : isFollowingPlayer ? 'Following your location' : 'Follow your location';
  const LocationIcon = activeRotationFollow ? NavigationArrow : isFollowingPlayer ? GpsFix : Gps;
  const boundariesVisible = showRegionProgress || progressMode;
  const activeLayerCount = [boundariesVisible, showBuildings3D, showTerrain3D].filter(Boolean).length;
  const toggleProgressMode = () => {
    const next = !progressMode;
    setProgressMode(next);
    if (next) {
      setFollowPlayer(false);
      setActiveRotationFollow(false);
      setIs3D(false);
      setSelectedProgressArea(currentArea);
      setSelectedParentAreaName(currentParentAreaName);
      pendingProgressFitRef.current = true;
    } else {
      pendingProgressFitRef.current = false;
      progressAreaControllerRef.current?.abort();
    }
  };
  const stepZoom = (direction: 1 | -1) => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      zoom: Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() + direction * 0.5)),
      ...(isFollowingPlayer && playerLocation ? {
        center: [playerLocation.lng, playerLocation.lat] as [number, number],
        offset: crosshairOffset(map, topOverlayInset),
      } : {}),
      duration: 350,
    });
  };
  return <section ref={mapViewRef} className={active ? "map-view" : "map-view map-view--inactive"} aria-hidden={!active}><MapCanvas mapRef={mapRef} viewportBottomInset={0} crosshairTopInset={topOverlayInset} showDiscovered={showDiscovered} showRegionProgress={boundariesVisible} progressMode={progressMode} is3D={is3D} showBuildings3D={showBuildings3D} showTerrain3D={showTerrain3D} sessionActive={sessionActive} playerLocation={playerLocation} followPlayer={!progressMode && followPlayer} activeRotationFollow={activeRotationFollow} discoveries={discoveries} onDiscoveries={onDiscoveries} onLocationChange={handleLocationChange} onBearingChange={handleBearingChange} onZoomChange={() => {}} onPitchChange={() => {}} onFollowPlayerChange={handleFollowChange} onMapReady={onMapReady} onVisualReady={onVisualReady} />{!isFollowingPlayer && <div className="map-center-crosshair" style={{ top: topOverlayInset }} aria-hidden="true"><span /></div>}
    <header ref={mapHeaderRef} className="map-header"><div className="map-top-right"><div ref={progressCardRef} className="location-summary map-ui-surface"><AreaCoverageCard record={displayedArea} discoveries={discoveries} dataReady={discoveriesLoaded} syncReady={initialSyncSettled} onUpdate={updateCurrentArea} onExplored={ignoreMapAreaExplored} parentAreaName={displayedParentAreaName ?? undefined} reserveParentArea showActions={false} className="min-h-0 border-0 bg-transparent p-0" /></div><div className="map-top-actions"><div className={`map-compass${compassVisible ? ' map-compass--visible' : ''}`} aria-hidden={!compassVisible}><ShadcnButton variant="secondary" size="icon" className="map-ui-surface" aria-label="Reset compass north" tabIndex={compassVisible ? 0 : -1} onClick={resetCompass}><span className="compass-rotor" style={{ transform: `rotate(${-bearing}deg)` }}><i className="compass-needle"><b className="compass-north">▲</b><b className="compass-south">▼</b></i></span></ShadcnButton></div></div></div></header>
    <div className="map-controls" style={{ bottom: sessionDockOffset }} aria-label="Map controls"><ShadcnButton variant="secondary" size="icon" className="map-ui-surface layers-control" aria-label={`Open layers panel, ${activeLayerCount} active`} aria-expanded={debugOpen} onClick={() => setDebugOpen(!debugOpen)}><Stack weight="regular" aria-hidden="true" />{activeLayerCount > 0 && <span className="layers-control__count" aria-hidden="true">{activeLayerCount}</span>}</ShadcnButton><ShadcnButton variant="secondary" size="icon" className={locationControlClass} aria-label={locationControlLabel} aria-pressed={isFollowingPlayer} onClick={centerOnPlayer}><LocationIcon weight={activeRotationFollow ? 'fill' : 'regular'} aria-hidden="true" /></ShadcnButton><ShadcnButton variant="secondary" size="icon" className="map-ui-surface map-mode-toggle" aria-label={`Switch to ${is3D ? '2D' : '3D'} view`} onClick={() => setIs3D(!is3D)}>{is3D ? '3D' : '2D'}</ShadcnButton><ButtonGroup orientation="vertical" className="zoom-group map-ui-surface" aria-label="Map zoom"><ShadcnButton variant="secondary" size="icon" aria-label="Zoom in" onClick={() => stepZoom(1)}><Plus weight="regular" aria-hidden="true" /></ShadcnButton><ShadcnButton variant="secondary" size="icon" aria-label="Zoom out" onClick={() => stepZoom(-1)}><Minus weight="regular" aria-hidden="true" /></ShadcnButton></ButtonGroup></div>{!sessionActive && <ShadcnButton variant="secondary" className="record-fab map-ui-surface" onClick={() => onSessionChange(true)}><Path weight="regular" aria-hidden="true" />Roam</ShadcnButton>}
    <ShadcnButton variant="secondary" size="medium" className="progress-mode-toggle map-ui-surface rounded-pill" aria-pressed={progressMode} onClick={toggleProgressMode}><Percent weight="regular" aria-hidden="true" />Progress</ShadcnButton>
    {showDebugMenu && debugOpen && <div className="map-layers-panel map-ui-surface" style={{ bottom: sessionDockOffset }}><p>LAYERS</p><label><span><strong>Region boundaries</strong><small>Administrative area outlines</small></span><Switch checked={boundariesVisible} disabled={progressMode} onCheckedChange={setShowRegionProgress} aria-label="Region boundaries" /></label><label><span><strong>3D buildings</strong><small>Building massing</small></span><Switch checked={showBuildings3D} onCheckedChange={setShowBuildings3D} aria-label="3D buildings" /></label><label><span><strong>3D terrain</strong><small>Elevation and shading</small></span><Switch checked={showTerrain3D} onCheckedChange={setShowTerrain3D} aria-label="3D terrain" /></label></div>}
    {!startupDismissed && <div className={`map-startup${startupCenterSettled ? ' map-startup--centered' : ''}${mapVisualReady ? ' map-startup--revealing' : ''}`} role="status" aria-label={mapVisualReady ? 'Map ready' : 'Loading map'}><div className="map-startup__mark" style={{ transform: `translateY(${topOverlayInset / 2}px)` }} aria-hidden="true" /></div>}
  </section>;
}

function formatItemText(value: string) {
  const lower = value.toLocaleLowerCase('sv-SE');
  const sentence = lower.charAt(0).toLocaleUpperCase('sv-SE') + lower.slice(1);
  return sentence.replace(/^Gps\b/, 'GPS').replace(/\b(\d+)d\b/gi, (_, digits: string) => `${digits}D`);
}

function SettingToggle({ label, description, value, onChange }: { label: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  const displayLabel = formatItemText(label);
  return <Item render={<label />} variant="outline" className="rounded-none border-0 border-b border-border-muted bg-transparent px-0 py-4 last:border-b-0"><ItemContent><ItemTitle>{displayLabel}</ItemTitle><ItemDescription>{description}</ItemDescription></ItemContent><Switch checked={value} onCheckedChange={onChange} aria-label={displayLabel} /></Item>;
}

type ButtonProps = ComponentPropsWithoutRef<'button'> & { variant?: 'primary' | 'secondary' | 'quiet'; size?: 'default' | 'compact' };

function Button({ className = '', variant = 'primary', size = 'default', type = 'button', ...props }: ButtonProps) {
  return <ShadcnButton variant={variant === 'primary' ? 'primary' : variant === 'secondary' ? 'secondary' : 'ghost'} size={size === 'compact' ? 'sm' : 'default'} className={className} type={type} {...props} />;
}

function IconButton({ label, children, className = '', ...props }: Omit<ButtonProps, 'children'> & { label: string; children: ReactNode }) {
  return <Button aria-label={label} className={`size-control rounded-pill p-0 ${className}`} variant="secondary" {...props}>{children}</Button>;
}

function Surface({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-panel border border-border bg-surface-raised ${className}`}>{children}</section>;
}

function Toggle({ label, description, value, onChange }: { label: string; description?: string; value: boolean; onChange: (value: boolean) => void }) {
  return <button className="flex min-h-control w-full items-center justify-between gap-4 px-0 text-left hover:text-paper-50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus" type="button" role="switch" aria-checked={value} onClick={() => onChange(!value)}><span className="flex min-w-0 flex-col gap-1"><span className="font-mono text-data font-semibold tracking-[0.06em] text-text">{label}</span>{description && <span className="text-body text-text-subtle">{description}</span>}</span><span className={`relative h-6 w-11 shrink-0 rounded-pill border transition-colors duration-200 ${value ? 'border-accent bg-accent-muted' : 'border-border-strong bg-control-off'}`} aria-hidden="true"><span className={`absolute top-[3px] size-4 rounded-full transition-all duration-200 ${value ? 'translate-x-[23px] bg-paper-100' : 'translate-x-[3px] bg-slate-400'}`} /></span></button>;
}

function Tabs<T extends string>({ items, value, onChange }: { items: ReadonlyArray<{ value: T; label: string }>; value: T; onChange: (value: T) => void }) {
  return <div className="inline-flex gap-4 border-b border-border-muted" role="tablist" aria-label="Design system sections">{items.map((item) => <button key={item.value} className={`min-h-control-compact border-b-2 font-mono text-overline-lg font-semibold uppercase tracking-[0.12em] transition-[color,border-color] duration-150 ease-outdoor focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus ${value === item.value ? 'border-accent text-paper-50' : 'border-transparent text-text-subtle hover:border-border-strong hover:text-text-muted'}`} type="button" role="tab" aria-selected={value === item.value} onClick={() => onChange(item.value)}>{item.label}</button>)}</div>;
}

const TOKEN_SEMANTIC = [
  ['location-500', 'bg-location-500'], ['location-200', 'bg-location-200'], ['danger-500', 'bg-danger-500'],
  ['surface', 'bg-surface'], ['surface-raised', 'bg-surface-raised'], ['surface-interactive', 'bg-surface-interactive'],
  ['text', 'bg-text'], ['text-muted', 'bg-text-muted'], ['text-subtle', 'bg-text-subtle'], ['border', 'bg-border'], ['border-subtle', 'bg-border-subtle'], ['border-muted', 'bg-border-muted'], ['border-strong', 'bg-border-strong'], ['focus', 'bg-focus'], ['accent', 'bg-accent'],
] as const;

const TOKEN_PRIMITIVES = [
  ['ink-700', 'bg-ink-700'], ['ink-800', 'bg-ink-800'], ['ink-900', 'bg-ink-900'], ['ink-950', 'bg-ink-950'],
  ['slate-300', 'bg-slate-300'], ['slate-400', 'bg-slate-400'], ['slate-500', 'bg-slate-500'], ['slate-600', 'bg-slate-600'],
  ['paper-50', 'bg-paper-50'], ['paper-100', 'bg-paper-100'], ['paper-200', 'bg-paper-200'], ['paper-300', 'bg-paper-300'],
] as const;

function TokenGrid({ tokens }: { tokens: ReadonlyArray<readonly [string, string]> }) {
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">{tokens.map(([name]) => <div key={name} className="min-w-0"><div className="h-12 w-full rounded-control border border-white/10" style={{ backgroundColor: `var(--color-${name})` }} /><p className="mt-2 truncate font-mono text-label text-text-muted">{name}</p></div>)}</div>;
}

const SEMANTIC_GROUPS = [
  ['Map & status', [['location-500', 'bg-location-500'], ['location-200', 'bg-location-200'], ['danger-500', 'bg-danger-500']]],
  ['Surfaces', [['surface', 'bg-surface'], ['surface-raised', 'bg-surface-raised'], ['surface-interactive', 'bg-surface-interactive']]],
  ['Content', [['text', 'bg-text'], ['text-muted', 'bg-text-muted'], ['text-subtle', 'bg-text-subtle']]],
  ['Borders & focus', [['border', 'bg-border'], ['border-subtle', 'bg-border-subtle'], ['border-muted', 'bg-border-muted'], ['border-strong', 'bg-border-strong'], ['focus', 'bg-focus']]],
  ['Accent', [['accent', 'bg-accent']]],
] as const;

const PRIMITIVE_GROUPS = [
  ['Ink · bright → dark', [['ink-700', 'bg-ink-700'], ['ink-800', 'bg-ink-800'], ['ink-900', 'bg-ink-900'], ['ink-950', 'bg-ink-950']]],
  ['Slate · bright → dark', [['slate-300', 'bg-slate-300'], ['slate-400', 'bg-slate-400'], ['slate-500', 'bg-slate-500'], ['slate-600', 'bg-slate-600']]],
  ['Paper · bright → dark', [['paper-50', 'bg-paper-50'], ['paper-100', 'bg-paper-100'], ['paper-200', 'bg-paper-200'], ['paper-300', 'bg-paper-300']]],
] as const;

function TokenGroups({ groups }: { groups: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]> }) {
  return <div className="space-y-6">{groups.map(([label, tokens]) => <section key={label}><p className="mb-3 font-mono text-label font-semibold tracking-[0.12em] text-text-subtle">{label}</p><TokenGrid tokens={tokens} /></section>)}</div>;
}

function ColorTokenTabs() {
  return <ShadcnTabs className="col-span-full w-full" defaultValue="semantic"><TabsList variant="line"><TabsTrigger value="semantic">Semantic</TabsTrigger><TabsTrigger value="primitives">Primitives</TabsTrigger></TabsList><TabsContent value="semantic" className="tab-panel pt-4"><TokenGroups groups={SEMANTIC_GROUPS} /></TabsContent><TabsContent value="primitives" className="tab-panel pt-4"><TokenGroups groups={PRIMITIVE_GROUPS} /></TabsContent></ShadcnTabs>;
}

// The active and legacy previews both consume this shared color-tab renderer.
const TOKEN_COLORS = { map: <T,>(_render: (value: readonly [string, string], index: number, values: ReadonlyArray<readonly [string, string]>) => T): ReactNode => <ColorTokenTabs /> };

function LegacyDesignSystemView({ onBack }: { onBack: () => void }) {
  const [previewToggle, setPreviewToggle] = useState(true);
  return <section className="min-h-[calc(100svh-76px)] overflow-auto bg-ink-950 px-6 pb-32 pt-8 text-text sm:px-8"><div className="mx-auto max-w-5xl"><header className="mb-10"><Button variant="quiet" size="compact" onClick={onBack}>← SETTINGS</Button><h1 className="mt-6 text-title font-semibold tracking-display">Design system</h1><p className="mt-4 max-w-xl text-body text-text-muted">A Swiss-inspired, outdoor map instrument: high-contrast, deliberately quiet, and built for reliable use on the move.</p></header>
    <div className="grid gap-8 lg:grid-cols-2"><div className="space-y-8"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">TYPE SCALE / GEIST</p><Surface className="divide-y divide-border-muted"><div className="p-4"><p className="text-title font-medium tracking-display">Navigate clearly</p><code className="mt-2 block font-mono text-label text-text-subtle">text-title · 38–64px · lh 0.95</code></div><div className="p-4"><p className="text-subheading font-medium tracking-subheading">Outdoor map instrument</p><code className="mt-2 block font-mono text-label text-text-subtle">text-subheading · 28px · lh 1.05</code></div><div className="p-4"><p className="text-heading font-medium tracking-heading">Section heading</p><code className="mt-2 block font-mono text-label text-text-subtle">text-heading · 22px · lh 1.15</code></div><div className="p-4"><p className="text-body-lg">Larger supporting copy for a key message or longer orientation statement.</p><code className="mt-2 block font-mono text-label text-text-subtle">text-body-lg · 16px · lh 1.5</code></div><div className="p-4"><p className="text-body">Legible descriptions are built for planning before a ride and checking a route at a glance.</p><code className="mt-2 block font-mono text-label text-text-subtle">text-body · 14px · lh 1.55</code></div></Surface></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">MONOSPACE / GEIST MONO</p><Surface className="divide-y divide-border-muted"><div className="p-4"><p className="font-mono text-mono-display font-semibold tracking-mono-display">47.2%</p><code className="mt-2 block font-mono text-label text-text-subtle">text-mono-display · 28–40px · lh 1.05</code></div><div className="p-4"><p className="font-mono text-mono-heading font-semibold tracking-mono-heading">Norrmalm / ready</p><code className="mt-2 block font-mono text-label text-text-subtle">text-mono-heading · 20px · lh 1.2</code></div><div className="p-4"><p className="font-mono text-data font-semibold tracking-[0.08em]">Norrmalm / 47.2% discovered</p><code className="mt-2 block font-mono text-label text-text-subtle">text-data · 14px · lh 1.35</code></div><div className="p-4"><p className="font-mono text-label font-semibold tracking-[0.14em]">Map display</p><code className="mt-2 block font-mono text-label text-text-subtle">text-label · 12px · lh 1.25</code></div><div className="p-4"><p className="font-mono text-overline font-semibold uppercase tracking-[0.16em]">Roam / Settings / System</p><code className="mt-2 block font-mono text-label text-text-subtle">text-overline · 12px · lh 1.2 · all caps</code></div></Surface></div></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">SEMANTIC COLOURS</p><Surface className="p-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{TOKEN_COLORS.map(([name, color]) => <div key={name} className="min-w-0"><div className={`h-12 rounded-control border border-white/10 ${color}`} /><p className="mt-2 truncate font-mono text-label text-text-muted">{name}</p></div>)}</div></Surface></div></div>
    <div className="mt-8 grid gap-8 lg:grid-cols-[1.15fr_0.85fr]"><div className="space-y-8">
      <div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">COMPONENTS</p><Surface className="space-y-5 p-4"><div className="flex flex-wrap gap-3"><Button>START SESSION</Button><Button variant="secondary">VIEW PROGRESS</Button><Button variant="quiet">CANCEL</Button><Button disabled>UNAVAILABLE</Button></div><div className="flex items-center gap-3 border-t border-border pt-5"><IconButton label="Locate rider">●</IconButton><IconButton label="Zoom in" variant="quiet">+</IconButton><IconButton label="Map layers">▦</IconButton></div><div className="border-t border-border pt-4"><Toggle label="DISCOVERED NETWORK" description="Highlight roads and paths you have uncovered." value={previewToggle} onChange={setPreviewToggle} /></div></Surface></div></div>
      <aside className="space-y-8"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">SPACING & SHAPE</p><Surface className="space-y-5 p-4">{[['space-1', '4px', 16], ['space-2', '8px', 32], ['space-3', '12px', 48], ['space-4', '16px', 64], ['space-6', '24px', 96], ['space-8', '32px', 128]].map(([name, value, width]) => <div key={name}><div className="mb-2 flex justify-between font-mono text-label text-text-subtle"><span>{name}</span><span>{value}</span></div><div className="h-2 rounded-pill bg-accent" style={{ width: `${width}px` }} /></div>)}<div className="grid grid-cols-5 gap-2 border-t border-border-muted pt-5"><div><div className="h-12 rounded-none bg-surface-interactive" /><p className="mt-2 font-mono text-overline text-text-subtle">0px</p></div><div><div className="h-12 rounded-tight bg-surface-interactive" /><p className="mt-2 font-mono text-overline text-text-subtle">4px</p></div><div><div className="h-12 rounded-control bg-surface-interactive" /><p className="mt-2 font-mono text-overline text-text-subtle">8px</p></div><div><div className="h-12 rounded-panel bg-surface-interactive" /><p className="mt-2 font-mono text-overline text-text-subtle">12px</p></div><div><div className="h-12 rounded-pill bg-surface-interactive" /><p className="mt-2 font-mono text-overline text-text-subtle">pill</p></div></div></Surface></div>
        <div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">ACCESSIBILITY BASELINE</p><Surface className="space-y-3 p-4 text-body text-text-muted"><p><span className="font-mono text-data font-semibold text-location-200">44px</span> minimum interactive target.</p><p><span className="font-mono text-data font-semibold text-location-200">3px</span> visible focus ring with offset.</p><p><span className="font-mono text-data font-semibold text-location-200">Sans</span> for UI reading; mono reserved for compact data labels.</p></Surface></div>
        <div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">MOTION</p><Surface className="p-4"><p className="font-mono text-data font-semibold tracking-[0.08em]">ease-outdoor</p><p className="mt-2 text-label text-text-muted">cubic-bezier(0.16, 1, 0.3, 1) · 150ms default</p><div className="mt-4 h-2 w-full rounded-pill bg-surface-interactive"><div className="h-2 w-2/3 rounded-pill bg-location-500 transition-all duration-150 ease-outdoor hover:w-full" /></div></Surface></div>
      </aside></div></div></section>;
}

function LegacyDesignSystemViewCurrent({ onBack }: { onBack: () => void }) {
  const [activeTab, setActiveTab] = useState<'foundations' | 'components'>('foundations');
  const [previewToggle, setPreviewToggle] = useState(true);
  const tabs = [{ value: 'foundations', label: 'FOUNDATIONS' }, { value: 'components', label: 'COMPONENTS' }] as const;
  return <section className="min-h-[calc(100svh-76px)] overflow-auto bg-ink-950 px-6 pb-32 pt-8 text-text sm:px-8"><div className="mx-auto max-w-5xl"><header className="mb-8"><Button variant="quiet" size="compact" onClick={onBack}>← SETTINGS</Button><h1 className="mt-6 text-title font-semibold tracking-display">Design system</h1><p className="mt-4 max-w-xl text-body text-text-muted">A Swiss-inspired outdoor map instrument: high-contrast, deliberately quiet, and built for reliable use on the move.</p></header><Tabs items={tabs} value={activeTab} onChange={setActiveTab} />
    {activeTab === 'foundations' ? <div className="mt-8 space-y-8"><div className="grid items-start gap-8 lg:grid-cols-2"><div className="space-y-8"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">TYPE SCALE / GEIST</p><Surface className="divide-y divide-border-muted"><div className="p-4"><p className="text-subheading font-medium tracking-subheading">Outdoor map instrument</p><code className="mt-2 block font-mono text-label text-text-subtle">text-subheading · 28px · lh 1.05</code></div><div className="p-4"><p className="text-heading font-medium tracking-heading">Section heading</p><code className="mt-2 block font-mono text-label text-text-subtle">text-heading · 22px · lh 1.15</code></div><div className="p-4"><p className="text-body-lg">Larger supporting copy for a key message or longer orientation statement.</p><code className="mt-2 block font-mono text-label text-text-subtle">text-body-lg · 16px · lh 1.5</code></div><div className="p-4"><p className="text-body">Legible descriptions are built for planning before a ride and checking a route at a glance.</p><code className="mt-2 block font-mono text-label text-text-subtle">text-body · 14px · lh 1.55</code></div></Surface></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">MONOSPACE / GEIST MONO</p><Surface className="divide-y divide-border-muted"><div className="p-4"><p className="font-mono text-mono-display font-semibold tracking-mono-display">47.2%</p><code className="mt-2 block font-mono text-label text-text-subtle">text-mono-display · 28–40px · lh 1.05</code></div><div className="p-4"><p className="font-mono text-mono-heading font-semibold tracking-mono-heading">Norrmalm / ready</p><code className="mt-2 block font-mono text-label text-text-subtle">text-mono-heading · 20px · lh 1.2</code></div><div className="p-4"><p className="font-mono text-data font-semibold tracking-[0.08em]">Norrmalm / 47.2% discovered</p><code className="mt-2 block font-mono text-label text-text-subtle">text-data · 14px · lh 1.35</code></div><div className="p-4"><p className="font-mono text-label font-semibold tracking-[0.14em]">Map display</p><code className="mt-2 block font-mono text-label text-text-subtle">text-label · 12px · lh 1.25</code></div><div className="p-4"><p className="font-mono text-overline font-semibold uppercase tracking-[0.16em]">Roam / Settings / System</p><code className="mt-2 block font-mono text-label text-text-subtle">text-overline · 12px · lh 1.2 · all caps</code></div></Surface></div></div><div className="space-y-8"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">SEMANTIC COLOURS</p><Surface className="p-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{TOKEN_COLORS.map(([name, color]) => <div key={name} className="min-w-0"><div className={`h-12 rounded-control border border-white/10 ${color}`} /><p className="mt-2 truncate font-mono text-label text-text-muted">{name}</p></div>)}</div></Surface></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">SPACING & SHAPE</p><Surface className="space-y-4 p-4">{[['space-1', '4px', 16], ['space-2', '8px', 32], ['space-3', '12px', 48], ['space-4', '16px', 64], ['space-6', '24px', 96], ['space-8', '32px', 128]].map(([name, value, width]) => <div key={name}><div className="mb-2 flex justify-between font-mono text-label text-text-subtle"><span>{name}</span><span>{value}</span></div><div className="h-2 rounded-pill bg-accent" style={{ width: `${width}px` }} /></div>)}<div className="grid grid-cols-5 gap-2 border-t border-border-muted pt-4">{[['rounded-none', '0px'], ['rounded-tight', '4px'], ['rounded-control', '8px'], ['rounded-panel', '12px'], ['rounded-pill', 'pill']].map(([radius, label]) => <div key={radius}><div className={`h-10 bg-surface-interactive ${radius}`} /><p className="mt-2 font-mono text-overline text-text-subtle">{label}</p></div>)}</div></Surface></div></div></div><div className="grid gap-8 lg:grid-cols-2"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">ACCESSIBILITY BASELINE</p><Surface className="space-y-3 p-4 text-body text-text-muted"><p><span className="font-mono text-data font-semibold text-location-200">44px</span> minimum interactive target.</p><p><span className="font-mono text-data font-semibold text-location-200">3px</span> visible focus ring with offset.</p><p><span className="font-mono text-data font-semibold text-location-200">Geist</span> for UI reading; mono reserved for compact data.</p></Surface></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">MOTION</p><Surface className="p-4"><p className="font-mono text-data font-semibold tracking-[0.08em]">ease-outdoor</p><p className="mt-2 text-body text-text-muted">cubic-bezier(0.16, 1, 0.3, 1) · 150ms default</p><div className="mt-4 h-2 w-full rounded-pill bg-surface-interactive"><div className="h-2 w-2/3 rounded-pill bg-location-500 transition-all duration-150 ease-outdoor hover:w-full" /></div></Surface></div></div></div> : <div className="mt-8 grid gap-8 lg:grid-cols-2"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">BUTTONS</p><Surface className="space-y-5 p-4"><div className="flex flex-wrap gap-3"><Button>START SESSION</Button><Button variant="secondary">VIEW PROGRESS</Button><Button variant="quiet">CANCEL</Button><Button disabled>UNAVAILABLE</Button></div><p className="border-t border-border-muted pt-4 text-body text-text-muted">Buttons use pill corners. Hover elevates contrast; press uses the route accent; disabled controls preserve the layout without relying on opacity alone.</p><div className="flex items-center gap-3 border-t border-border-muted pt-4"><IconButton label="Locate rider">●</IconButton><IconButton label="Zoom in" variant="quiet">+</IconButton><IconButton label="Map layers">▦</IconButton></div></Surface></div><div className="space-y-8"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">TOGGLE</p><Surface className="p-4"><p className="mb-4 text-body text-text-muted">The larger switch keeps its 44px touch target and shows the current setting at a glance.</p><Toggle label="DISCOVERED NETWORK" description="Highlight roads and paths you have uncovered." value={previewToggle} onChange={setPreviewToggle} /></Surface></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">TABS</p><Surface className="p-4"><p className="mb-4 text-body text-text-muted">A compact section switcher with a persistent active indicator and keyboard-accessible tab semantics.</p><Tabs items={tabs} value={activeTab} onChange={setActiveTab} /></Surface></div></div></div>}</div></section>;
}

function LegacyDesignSystemViewActive({ onBack }: { onBack: () => void }) {
  const [activeTab, setActiveTab] = useState<'foundations' | 'components'>('foundations');
  const [previewToggle, setPreviewToggle] = useState(true);
  const [buttonSize, setButtonSize] = useState<'large' | 'medium' | 'small'>('large');
  const variants = [
    ['Primary', 'primary'],
    ['Secondary', 'secondary'],
    ['Ghost', 'ghost'],
    ['Destructive', 'destructive'],
    ['Disabled', 'primary'],
  ] as const;

  const buttonCell = (variant: 'primary' | 'secondary' | 'ghost' | 'destructive', disabled: boolean, content: ReactNode) => (
    <ShadcnButton variant={variant} size={buttonSize} disabled={disabled} className="w-full">{content}</ShadcnButton>
  );

  return <section className={`design-button-preview design-button-preview--${buttonSize} min-h-[calc(100svh-76px)] overflow-auto bg-ink-950 px-6 pb-32 pt-8 text-text sm:px-8`}><div className="mx-auto max-w-5xl">
    <header className="mb-8"><Button variant="quiet" size="compact" onClick={onBack}>← Settings</Button><h1 className="mt-6 text-title font-semibold tracking-display">Design system</h1><p className="mt-4 max-w-xl text-body text-text-muted">A Swiss-inspired outdoor map instrument: high contrast, deliberately quiet, and built for reliable use on the move.</p></header>
    <ShadcnTabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'foundations' | 'components')}>
      <TabsList variant="line" aria-label="Design system sections"><TabsTrigger value="foundations">Foundations</TabsTrigger><TabsTrigger value="components">Components</TabsTrigger></TabsList>
      <div className="mt-4 flex items-center gap-3"><span className="font-mono text-label text-text-subtle">Button preview size</span><Select value={buttonSize} onValueChange={value => setButtonSize(value as 'large' | 'medium' | 'small')}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="large">Large · 16pt</SelectItem><SelectItem value="medium">Medium · 14pt</SelectItem><SelectItem value="small">Small · 12pt</SelectItem></SelectContent></Select></div>
      <TabsContent value="foundations" className="tab-panel mt-8 space-y-8">
        <div className="grid items-start gap-8 lg:grid-cols-2"><div className="space-y-8"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">TYPE SCALE / GEIST</p><Surface className="divide-y divide-border-muted"><div className="p-4"><p className="text-subheading font-medium tracking-subheading">Outdoor map instrument</p><code className="mt-2 block font-mono text-label text-text-subtle">text-subheading · 28px · lh 1.05</code></div><div className="p-4"><p className="text-heading font-medium tracking-heading">Section heading</p><code className="mt-2 block font-mono text-label text-text-subtle">text-heading · 22px · lh 1.15</code></div><div className="p-4"><p className="text-body-lg">Larger supporting copy for a key message or longer orientation statement.</p><code className="mt-2 block font-mono text-label text-text-subtle">text-body-lg · 16px · lh 1.5</code></div><div className="p-4"><p className="text-body">Legible descriptions are built for planning before a ride and checking a route at a glance.</p><code className="mt-2 block font-mono text-label text-text-subtle">text-body · 14px · lh 1.55</code></div></Surface></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">MONOSPACE / GEIST MONO</p><Surface className="divide-y divide-border-muted"><div className="p-4"><p className="font-mono text-mono-display font-semibold tracking-mono-display">47.2%</p><code className="mt-2 block font-mono text-label text-text-subtle">text-mono-display · 28–40px · lh 1.05</code></div><div className="p-4"><p className="font-mono text-mono-heading font-semibold tracking-mono-heading">Norrmalm / ready</p><code className="mt-2 block font-mono text-label text-text-subtle">text-mono-heading · 20px · lh 1.2</code></div><div className="p-4"><p className="font-mono text-data font-semibold tracking-[0.08em]">Norrmalm / 47.2% discovered</p><code className="mt-2 block font-mono text-label text-text-subtle">text-data · 14px · lh 1.35</code></div><div className="p-4"><p className="font-mono text-label font-semibold tracking-[0.14em]">Map display</p><code className="mt-2 block font-mono text-label text-text-subtle">text-label · 12px · lh 1.25</code></div><div className="p-4"><p className="font-mono text-overline font-semibold uppercase tracking-[0.16em]">Roam / Settings / System</p><code className="mt-2 block font-mono text-label text-text-subtle">text-overline · 12px · lh 1.2 · all caps</code></div></Surface></div></div><div className="space-y-8"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">SEMANTIC COLOURS</p><Surface className="p-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{TOKEN_COLORS.map(([name, color]) => <div key={name} className="min-w-0"><div className={`h-12 rounded-control border border-white/10 ${color}`} /><p className="mt-2 truncate font-mono text-label text-text-muted">{name}</p></div>)}</div></Surface></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">SPACING & SHAPE</p><Surface className="space-y-4 p-4">{[['space-1', '4px', 16], ['space-2', '8px', 32], ['space-3', '12px', 48], ['space-4', '16px', 64], ['space-6', '24px', 96], ['space-8', '32px', 128]].map(([name, value, width]) => <div key={name}><div className="mb-2 flex justify-between font-mono text-label text-text-subtle"><span>{name}</span><span>{value}</span></div><div className="h-2 rounded-pill bg-accent" style={{ width: `${width}px` }} /></div>)}<div className="grid grid-cols-5 gap-2 border-t border-border-muted pt-4">{[['rounded-none', '0px'], ['rounded-tight', '4px'], ['rounded-control', '8px'], ['rounded-panel', '12px'], ['rounded-pill', 'pill']].map(([radius, label]) => <div key={radius}><div className={`h-10 bg-surface-interactive ${radius}`} /><p className="mt-2 font-mono text-overline text-text-subtle">{label}</p></div>)}</div></Surface></div></div></div>
        <div className="grid gap-8 lg:grid-cols-2"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">ACCESSIBILITY BASELINE</p><Surface className="space-y-3 p-4 text-body text-text-muted"><p><span className="font-mono text-data font-semibold text-location-200">44px</span> minimum interactive target.</p><p><span className="font-mono text-data font-semibold text-location-200">3px</span> visible focus ring with offset.</p><p><span className="font-mono text-data font-semibold text-location-200">Geist</span> for UI reading; mono reserved for compact data.</p><p><span className="roam-overline-sm text-text-subtle">Active session / Stockholms kommun</span><span className="ml-2">10px mono overline for compact context.</span></p></Surface></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">MOTION</p><Surface className="p-4"><p className="font-mono text-data font-semibold tracking-[0.08em]">ease-outdoor</p><p className="mt-2 text-body text-text-muted">cubic-bezier(0.16, 1, 0.3, 1) · 150ms default</p><div className="mt-4 h-2 w-full rounded-pill bg-surface-interactive"><div className="h-2 w-2/3 rounded-pill bg-location-500 transition-all duration-150 ease-outdoor hover:w-full" /></div></Surface></div></div>
      </TabsContent>
      <TabsContent value="components" className="tab-panel mt-8 space-y-8"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">BUTTON MATRIX</p><Surface className="overflow-x-auto p-4"><p className="mb-5 text-body text-text-muted">shadcn Button variants use Roam colour, spacing, type and radius tokens. Text buttons use the regular Geist weight for a calmer, more readable outdoor interface; hover, pressed and disabled states are built into each source variant.</p><div className="min-w-[720px] overflow-hidden rounded-panel border border-border-muted"><div className="grid grid-cols-[110px_repeat(4,minmax(130px,1fr))] text-center"><div className="border-b border-border-muted p-3 text-left font-mono text-label text-text-subtle">Variant</div><div className="border-b border-border-muted p-3 text-body text-text-muted">Text</div><div className="border-b border-border-muted p-3 text-body text-text-muted">Left icon</div><div className="border-b border-border-muted p-3 text-body text-text-muted">Right icon</div><div className="border-b border-border-muted p-3 text-body text-text-muted">Spinner</div>{variants.flatMap(([label, variant]) => { const disabled = label === 'Disabled'; return [<div key={`${label}-label`} className="flex items-center border-b border-border-muted p-3 text-left font-mono text-label text-text-subtle">{label}</div>, <div key={`${label}-text`} className="border-b border-border-muted p-2">{buttonCell(variant, disabled, 'Continue')}</div>, <div key={`${label}-left`} className="border-b border-border-muted p-2">{buttonCell(variant, disabled, <><span data-icon="inline-start" aria-hidden="true">←</span>Continue</>)}</div>, <div key={`${label}-right`} className="border-b border-border-muted p-2">{buttonCell(variant, disabled, <>Continue<span data-icon="inline-end" aria-hidden="true">→</span></>)}</div>, <div key={`${label}-spinner`} className="border-b border-border-muted p-2">{buttonCell(variant, disabled, <><Spinner />Continue</>)}</div>]; })}</div></div></Surface></div>
        <div className="grid gap-8 lg:grid-cols-2"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">ICON BUTTON MATRIX</p><Surface className="space-y-5 overflow-x-auto p-4"><div className="grid min-w-[520px] grid-cols-[110px_repeat(5,1fr)] overflow-hidden rounded-panel border border-border-muted text-center"><div className="border-b border-border-muted p-3 text-left font-mono text-label text-text-subtle">Variant</div><div className="border-b border-border-muted p-3 text-body text-text-muted">Primary</div><div className="border-b border-border-muted p-3 text-body text-text-muted">Secondary</div><div className="border-b border-border-muted p-3 text-body text-text-muted">Ghost</div><div className="border-b border-border-muted p-3 text-body text-text-muted">Destructive</div><div className="border-b border-border-muted p-3 text-body text-text-muted">Disabled</div><div className="flex items-center border-b border-border-muted p-3 text-left font-mono text-label text-text-subtle">Icon button</div>{(['primary', 'secondary', 'ghost', 'destructive'] as const).map((variant, index) => <div key={variant} className="flex justify-center border-b border-border-muted p-2"><ShadcnButton variant={variant} size="icon" aria-label={`${variant} icon button`}>{['●', '+', '▦', '×'][index]}</ShadcnButton></div>)}<div className="flex justify-center border-b border-border-muted p-2"><ShadcnButton variant="primary" size="icon" disabled aria-label="Disabled icon button">●</ShadcnButton></div></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">BUTTON GROUP</p><ButtonGroup><ShadcnButton variant="secondary">Day</ShadcnButton><ShadcnButton variant="secondary">Week</ShadcnButton><ShadcnButton variant="secondary">Month</ShadcnButton></ButtonGroup></div></Surface></div><div className="space-y-8"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">SWITCH</p><p className="mb-3 text-body text-text-muted">Use the larger default switch for settings. The full row remains an accessible touch target. Enabled switches show a subtle hover state and a pointer cursor; disabled switches keep their inactive state.</p><Surface className="flex min-h-control items-center justify-between gap-4 p-4"><span><span className="block text-body-lg font-medium">Discovered network</span><span className="mt-1 block text-body text-text-subtle">Highlight roads and paths you have uncovered.</span></span><Switch checked={previewToggle} onCheckedChange={setPreviewToggle} aria-label="Toggle discovered network" /></Surface><Surface className="mt-3 flex min-h-control items-center justify-between gap-4 p-4"><span className="text-body text-text-muted">Unavailable setting</span><Switch disabled checked aria-label="Unavailable setting" /></Surface></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">TABS / LINE</p><Surface className="p-4"><p className="mb-4 text-body text-text-muted">The line variant keeps the active bar exactly as wide as its label and uses a short content transition.</p><ShadcnTabs defaultValue="routes"><TabsList variant="line"><TabsTrigger value="routes">Routes</TabsTrigger><TabsTrigger value="saved">Saved places</TabsTrigger></TabsList><TabsContent value="routes" className="tab-panel pt-4 text-body text-text-muted">Your active routes appear here.</TabsContent><TabsContent value="saved" className="tab-panel pt-4 text-body text-text-muted">Your saved places appear here.</TabsContent></ShadcnTabs></Surface></div></div></div>
        <ProgressTransitionPreview />
      </TabsContent>
      <DesignSystemReusableComponents />
    </ShadcnTabs>
  </div></section>;
}

function LegacyDesignSystemViewPage({ onBack }: { onBack: () => void }) {
  return <><LegacyDesignSystemViewActive onBack={onBack} /><section className="min-h-[calc(100svh-76px)] bg-ink-950 px-6 pb-32 pt-8 text-text sm:px-8"><div className="mx-auto max-w-5xl"><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">ITEM</p><Surface className="max-w-2xl p-4"><div className="space-y-3"><Item variant="outline"><ItemContent><ItemTitle>Map display</ItemTitle><ItemDescription>Show buildings and terrain context while exploring.</ItemDescription></ItemContent><Switch checked aria-label="Map display preview" /></Item><Item variant="muted"><ItemContent><ItemTitle>Developer tools</ItemTitle><ItemDescription>Keep diagnostic controls available for this preview.</ItemDescription></ItemContent><ItemActions><ShadcnButton variant="secondary" size="sm">Open</ShadcnButton></ItemActions></Item></div></Surface></div></section></>;
}

function DesignSystemReusableComponents() {
  return <TabsContent value="components" className="tab-panel mt-8 space-y-8">
    <div>
      <p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">REUSABLE COMPONENTS</p>
      <Surface className="grid gap-8 p-4 lg:grid-cols-2">
        <div className="space-y-3">
          <p className="text-body font-medium">Select</p>
          <p className="text-body text-text-muted">A shadcn Select with a constrained, scrollable menu.</p>
          <Select>
            <SelectTrigger className="w-full min-h-control"><SelectValue placeholder="Choose a municipality" /></SelectTrigger>
            <SelectContent>{SWEDEN_MUNICIPALITIES_SORTED.slice(0, 12).map((municipality) => <SelectItem key={municipality} value={municipality.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}>{municipality}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-3">
          <p className="text-body font-medium">Accordion</p>
          <p className="text-body text-text-muted">A composable shadcn Accordion with animated content.</p>
          <Accordion multiple className="w-full rounded-control border border-border-muted px-3">
            <AccordionItem value="one"><AccordionTrigger>Section one</AccordionTrigger><AccordionContent>Reusable content can be revealed without replacing the surrounding layout.</AccordionContent></AccordionItem>
            <AccordionItem value="two"><AccordionTrigger>Section two</AccordionTrigger><AccordionContent>All primitives remain source-owned in the design system.</AccordionContent></AccordionItem>
          </Accordion>
        </div>
        <div className="space-y-3">
          <p className="text-body font-medium">Toast</p>
          <p className="text-body text-text-muted">A transient, screen-reader announced status for an upload, export, or sync. It stays visible while work is in progress, then can be dismissed after success or failure.</p>
          <div className="flex items-start gap-3 rounded-panel border border-border-strong bg-surface p-4 shadow-xl"><CheckCircle className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" /><div><p className="font-sans text-body font-semibold">Ride uploaded</p><p className="mt-1 text-body text-text-muted">The route was added to your sessions and exploration progress.</p></div></div>
        </div>
      </Surface>
    </div>
  </TabsContent>;
}

function DesignSystemView({ onBack }: { onBack: () => void }) {
  return <LegacyDesignSystemViewActive onBack={onBack} />;
}

function SettingsViewBase({ showBuildings3D, setShowBuildings3D, showTerrain3D, setShowTerrain3D, gpsEnabled, gpsPermission, onGpsChange, onOpenDesignSystem }: { showBuildings3D: boolean; setShowBuildings3D: (value: boolean) => void; showTerrain3D: boolean; setShowTerrain3D: (value: boolean) => void; gpsEnabled: boolean; gpsPermission: GpsPermission; onGpsChange: (value: boolean) => void; onOpenDesignSystem: () => void }) {
  const gpsDescription = gpsPermission === 'denied' ? 'Location access was denied. Enable it in browser settings to retry.' : 'Show your live position on the map.';
  return <section className="min-h-[calc(100svh-76px)] overflow-auto bg-surface px-6 pb-32 pt-10 text-text sm:px-8"><div className="mx-auto max-w-2xl"><header className="mb-10"><h1 className="font-sans text-title font-semibold tracking-display">Settings</h1><p className="mt-4 max-w-xl text-body-lg text-text-muted">Shape the map to match how you explore. Changes apply immediately.</p></header><div className="space-y-8"><section className="rounded-panel border border-border bg-surface-raised px-4"><p className="-mx-4 border-b border-border-muted px-4 py-3 font-mono text-overline font-semibold tracking-[0.14em] text-accent">MAP DISPLAY</p><SettingToggle label="BUILDINGS 3D" description="Show building massing above the map." value={showBuildings3D} onChange={setShowBuildings3D} /><SettingToggle label="TERRAIN 3D" description="Show elevation and terrain shading." value={showTerrain3D} onChange={setShowTerrain3D} /></section><section className="rounded-panel border border-border bg-surface-raised px-4"><p className="-mx-4 border-b border-border-muted px-4 py-3 font-mono text-overline font-semibold tracking-[0.14em] text-accent">PLAYER</p><SettingToggle label="GPS LOCATION" description={gpsDescription} value={gpsEnabled} onChange={onGpsChange} /></section><section className="rounded-panel border border-border bg-surface-raised px-4"><p className="-mx-4 border-b border-border-muted px-4 py-3 font-mono text-overline font-semibold tracking-[0.14em] text-accent">DEVELOPER TOOLS</p><ShadcnButton variant="ghost" className="design-system-link flex min-h-control w-full justify-between rounded-none border-0 bg-transparent px-0 text-left text-text" type="button" onClick={onOpenDesignSystem}><span className="flex min-w-0 flex-col items-start gap-1"><strong className="font-mono text-data font-semibold tracking-[0.06em]">DESIGN SYSTEM</strong><small className="text-body text-text-subtle">Preview tokens and reusable interface components.</small></span><b aria-hidden="true" className="font-mono text-data text-accent">→</b></ShadcnButton></section><aside className="rounded-control border-l-2 border-accent bg-accent-muted px-4 py-3"><strong className="block font-mono text-label font-semibold tracking-[0.12em] text-accent">3D VIEW</strong><span className="mt-1 block text-body text-text-muted">Use the 3D button on the map to switch between flat and tilted views.</span></aside></div></div></section>;
}

function PlaceholderView({ title, copy }: { title: string; copy: string }) { return <section className="min-h-[calc(100svh-76px)] overflow-auto bg-surface px-6 pb-32 pt-10 text-text sm:px-8"><div className="mx-auto max-w-2xl"><h1 className="font-sans text-title font-semibold tracking-display">{title}</h1><p className="mt-4 max-w-xl text-body-lg text-text-muted">{copy}</p><Item variant="outline" className="mt-10"><ItemContent><ItemTitle>Module ready</ItemTitle><ItemDescription>The next Sessions build slice will add route history and saved rides.</ItemDescription></ItemContent><ItemActions><span className="font-mono text-label text-accent">NEXT</span></ItemActions></Item></div></section>; }

function SessionRouteFallback({ coordinates }: { coordinates: [number, number][] }) {
  const usableCoordinates = coordinates.filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90);
  if (usableCoordinates.length < 2) return <div className="session-route-fallback flex items-center justify-center text-label text-text-subtle">Route preview unavailable</div>;
  const longitudeCenter = (Math.min(...usableCoordinates.map(([lng]) => lng)) + Math.max(...usableCoordinates.map(([lng]) => lng))) / 2;
  const latitudeCenter = (Math.min(...usableCoordinates.map(([, lat]) => lat)) + Math.max(...usableCoordinates.map(([, lat]) => lat))) / 2;
  const longitudeScale = Math.cos(latitudeCenter * Math.PI / 180);
  const horizontalSpread = Math.max(...usableCoordinates.map(([lng]) => Math.abs((lng - longitudeCenter) * longitudeScale)), 0.00001);
  const verticalSpread = Math.max(...usableCoordinates.map(([, lat]) => Math.abs(lat - latitudeCenter)), 0.00001);
  const scale = Math.min(42 / horizontalSpread, 22 / verticalSpread);
  const project = ([lng, lat]: [number, number]) => [50 + (lng - longitudeCenter) * longitudeScale * scale, 28 - (lat - latitudeCenter) * scale] as const;
  const smoothedCoordinates = usableCoordinates.map((coordinate, index) => {
    if (index === 0 || index === usableCoordinates.length - 1) return coordinate;
    const previous = usableCoordinates[index - 1];
    const next = usableCoordinates[index + 1];
    return [(previous[0] + coordinate[0] * 2 + next[0]) / 4, (previous[1] + coordinate[1] * 2 + next[1]) / 4] as [number, number];
  }).filter((coordinate, index, all) => {
    if (index === 0 || index === all.length - 1) return true;
    const previous = all[index - 1];
    return Math.hypot((coordinate[0] - previous[0]) * longitudeScale, coordinate[1] - previous[1]) > 0.000035;
  });
  const routePath = smoothedCoordinates.map((coordinate, index) => `${index === 0 ? 'M' : 'L'} ${project(coordinate).join(' ')}`).join(' ');
  const start = project(smoothedCoordinates[0]);
  const end = project(smoothedCoordinates[smoothedCoordinates.length - 1]);
  return <div className="session-route-fallback" aria-hidden="true"><svg viewBox="0 0 100 56" preserveAspectRatio="xMidYMid meet"><path className="session-route-fallback-grid" d="M0 14H100M0 28H100M0 42H100M25 0V56M50 0V56M75 0V56" /><path className="session-route-fallback-line" d={routePath} /><circle className="session-route-fallback-start" cx={start[0]} cy={start[1]} r="2" /><g className="session-route-fallback-finish" transform={`translate(${end[0]} ${end[1]})`}><circle r="3.6" /><path className="session-route-fallback-flag" d="M-1.25 1.8V-2.1H1.7V1.1H-1.25" /><path className="session-route-fallback-checkers" d="M-1.25-2.1H.25V-.5H-1.25M.25-.5H1.7V1.1H.25" /></g></svg></div>;
}

function SettingsView({ showBuildings3D, setShowBuildings3D, showTerrain3D, setShowTerrain3D, gpsEnabled, gpsPermission, onGpsChange, onOpenDesignSystem }: Parameters<typeof SettingsViewBase>[0]) {
  const gpsDescription = gpsPermission === 'denied'
    ? 'Location access was denied. Enable it in browser settings to retry.'
    : 'Show your live position on the map.';

  return <section className="min-h-[calc(100svh-76px)] overflow-auto bg-surface px-4 pb-32 pt-10 text-text sm:px-4">
    <div className="mx-auto max-w-2xl">
      <header className="mb-4">
        <h1 className="font-sans text-title font-semibold tracking-display">Settings</h1>
        <p className="mt-4 max-w-xl text-body-lg text-text-muted">Shape the map to match how you explore. Changes apply immediately.</p>
      </header>
      <div className="space-y-4">
        <AccountSettings />
        <section className="rounded-panel border border-border bg-surface-raised px-4">
          <p className="roam-overline -mx-4 border-b border-border-muted px-4 py-3 text-accent">MAP DISPLAY</p>
          <SettingToggle label="BUILDINGS 3D" description="Show building massing above the map." value={showBuildings3D} onChange={setShowBuildings3D} />
          <SettingToggle label="TERRAIN 3D" description="Show elevation and terrain shading." value={showTerrain3D} onChange={setShowTerrain3D} />
        </section>
        <section className="rounded-panel border border-border bg-surface-raised px-4">
          <p className="roam-overline -mx-4 border-b border-border-muted px-4 py-3 text-accent">PLAYER</p>
          <SettingToggle label="GPS LOCATION" description={gpsDescription} value={gpsEnabled} onChange={onGpsChange} />
        </section>
        <section className="rounded-panel border border-border bg-surface-raised px-4">
          <p className="roam-overline -mx-4 border-b border-border-muted px-4 py-3 text-accent">DEVELOPER TOOLS</p>
          <ShadcnButton variant="ghost" className="design-system-link flex min-h-control w-full justify-between rounded-none border-0 bg-transparent px-0 text-left text-text" type="button" onClick={onOpenDesignSystem}>
            <span className="flex min-w-0 flex-col items-start gap-1"><strong className="font-mono text-data font-semibold tracking-[0.06em]">DESIGN SYSTEM</strong><small className="text-body text-text-subtle">Preview tokens and reusable interface components.</small></span>
            <b aria-hidden="true" className="font-mono text-data text-accent">→</b>
          </ShadcnButton>
        </section>
        <aside className="rounded-control border-l-2 border-accent bg-accent-muted px-4 py-3">
          <strong className="block font-mono text-label font-semibold tracking-[0.12em] text-accent">3D VIEW</strong>
          <span className="mt-1 block text-body text-text-muted">Use the 3D button on the map to switch between flat and tilted views.</span>
        </aside>
      </div>
    </div>
  </section>;
}

function SessionRoutePreview({ session }: { session: RideSession }) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!session.thumbnail) { setThumbnailUrl(null); return; }
    const url = URL.createObjectURL(session.thumbnail);
    setThumbnailUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [session.thumbnail]);
  const points = session.points;
  const coordinates = useMemo(() => points.map(point => [point.lng, point.lat] as [number, number]).filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90), [points]);
  return <div className="session-route-preview mt-4 aspect-[2/1] overflow-hidden rounded-control border border-border-muted" aria-label="Session route preview">{thumbnailUrl ? <img className="session-route-thumbnail" src={thumbnailUrl} alt="" /> : <SessionRouteFallback coordinates={coordinates} />}</div>;
}

function SessionsView({ sessions, onExport, onRename, onDelete, onImportGpx, onRefresh }: { sessions: RideSession[]; onExport: (session: RideSession) => void; onRename: (session: RideSession, title: string) => void; onDelete: (session: RideSession) => void; onImportGpx: (file: File) => Promise<string>; onRefresh: () => Promise<void> }) {
  const [editingSession, setEditingSession] = useState<RideSession | null>(null);
  const [editedTitle, setEditedTitle] = useState('');
  const [deletingSession, setDeletingSession] = useState<RideSession | null>(null);
  const [isPageActionPending, setIsPageActionPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshError, setRefreshError] = useState('');
  const sectionRef = useRef<HTMLElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const pullDistanceRef = useRef(0);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const refreshFromCloud = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError('');
    try { await onRefresh(); }
    catch (error) { setRefreshError(error instanceof Error ? error.message : 'Could not refresh. Pull down to try again.'); }
    finally { setRefreshing(false); }
  };
  const resetPull = () => { touchStartRef.current = null; pullDistanceRef.current = 0; setPullDistance(0); };
  const onTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    if (refreshing || sectionRef.current?.scrollTop !== 0 || event.touches.length !== 1) return;
    touchStartRef.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  };
  const onTouchMove = (event: React.TouchEvent<HTMLElement>) => {
    const start = touchStartRef.current;
    if (!start || sectionRef.current?.scrollTop !== 0) return;
    const deltaY = event.touches[0].clientY - start.y;
    if (deltaY <= 0 || Math.abs(event.touches[0].clientX - start.x) > deltaY) return;
    pullDistanceRef.current = Math.min(96, deltaY * 0.55);
    setPullDistance(pullDistanceRef.current);
  };
  const onTouchEnd = () => {
    const shouldRefresh = pullDistanceRef.current >= 64;
    resetPull();
    if (shouldRefresh) void refreshFromCloud();
  };
  const startEditing = (session: RideSession) => { setEditingSession(session); setEditedTitle(formatSessionTitle(session.title)); };
  const saveTitle = () => { if (editingSession && editedTitle.trim()) onRename(editingSession, editedTitle.trim()); setEditingSession(null); };
  const runPageAction = async (action: () => Promise<string>, pendingTitle: string, successTitle: string, pendingDescription: string) => {
    if (isPageActionPending) return;
    setIsPageActionPending(true);
    const id = crypto.randomUUID();
    toastManager.add({ id, title: pendingTitle, description: pendingDescription, timeout: 0, data: { kind: 'loading' } });
    try { toastManager.update(id, { title: successTitle, description: await action(), timeout: 5_000, data: { kind: 'success' } }); }
    catch (error) { toastManager.update(id, { title: 'Upload failed', description: error instanceof Error ? error.message : 'Could not update your sessions. Try again.', timeout: 7_000, priority: 'high', data: { kind: 'error' } }); }
    finally { setIsPageActionPending(false); }
  };
  return <section ref={sectionRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={resetPull} className="sessions-scroll min-h-[calc(100svh-76px)] overflow-auto bg-surface px-6 pb-32 pt-10 text-text sm:px-8"><div className="sessions-pull-indicator" style={{ height: refreshing ? 56 : pullDistance }} role={refreshing || pullDistance > 0 ? "status" : undefined} aria-label={refreshing ? "Refreshing sessions from cloud" : pullDistance >= 64 ? "Release to refresh sessions" : pullDistance > 0 ? "Pull to refresh sessions" : undefined}>{refreshing ? <Spinner aria-hidden="true" /> : <ArrowsClockwise aria-hidden="true" />}</div><div className="mx-auto max-w-2xl"><div className="flex items-start justify-between gap-4"><h1 className="font-sans text-title font-semibold tracking-display">Sessions</h1><DropdownMenu><DropdownMenuTrigger aria-label="Session actions" className={buttonVariants({ variant: "secondary", size: "icon-large" })}><DotsThreeOutline weight="fill" aria-hidden="true" /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={refreshing} onClick={() => { void refreshFromCloud(); }}><ArrowsClockwise aria-hidden="true" />Refresh from cloud</DropdownMenuItem><DropdownMenuItem disabled={isPageActionPending} onClick={() => uploadInputRef.current?.click()}><UploadSimple aria-hidden="true" />Upload GPX</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div><input ref={uploadInputRef} className="sr-only" type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void runPageAction(() => onImportGpx(file), 'Uploading GPX', 'Ride uploaded', `Reading ${file.name}`); }} />{refreshError && <p className="mt-4 text-body text-danger-500" role="alert">{refreshError}</p>}<p className="mt-4 max-w-xl text-body-lg text-text-muted">Your rides are saved on this device and sync to your account when online.</p>{sessions.length === 0 ? <Item variant="outline" className="mt-4"><ItemContent><ItemTitle>No saved rides yet</ItemTitle><ItemDescription>Rides shorter than 30 seconds are discarded.</ItemDescription></ItemContent></Item> : <div className="mt-4 space-y-4">{sessions.map(session => <Item key={session.id} variant="outline" className="block p-4"><div className="flex items-start justify-between gap-4"><ItemContent><time dateTime={new Date(session.startedAt).toISOString()} className="roam-overline-sm text-text-subtle">{formatSessionDateTime(session.startedAt)}</time><ItemTitle className="mt-1">{formatSessionTitle(session.title)}</ItemTitle></ItemContent><DropdownMenu><DropdownMenuTrigger aria-label={`Actions for ${formatSessionTitle(session.title)}`} className={buttonVariants({ variant: "ghost", size: "icon-small" })}><DotsThreeOutline weight="fill" aria-hidden="true" /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => onExport(session)}><DownloadSimple aria-hidden="true" />Export GPX</DropdownMenuItem><DropdownMenuItem onClick={() => startEditing(session)}><PencilSimple aria-hidden="true" />Edit session title</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-danger-500 data-[highlighted]:bg-danger-button data-[highlighted]:text-paper-50" onClick={() => setDeletingSession(session)}><Trash aria-hidden="true" />Delete session</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div><div className="mt-2 font-mono text-data text-text-muted">{formatSessionTime(session.durationSeconds)} • {formatDistance(session.distanceMeters)} ({formatDistance(session.newDistanceMeters)} new)</div>{session.points.length > 1 && <SessionRoutePreview session={session} />}</Item>)}</div>}</div><Dialog open={Boolean(editingSession)} onOpenChange={open => { if (!open) setEditingSession(null); }}><DialogContent><DialogTitle>Edit session title</DialogTitle><DialogDescription>Give this ride a name you will recognize later.</DialogDescription><form className="mt-5" onSubmit={event => { event.preventDefault(); saveTitle(); }}><label className="block text-label text-text-subtle" htmlFor="session-title">Title</label><input id="session-title" className="mt-2 min-h-control w-full rounded-control border border-border bg-surface px-3 text-body text-text outline-none focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-focus" value={editedTitle} onChange={event => setEditedTitle(event.target.value)} autoFocus /><div className="mt-5 flex justify-end gap-3"><ShadcnButton type="button" variant="ghost" onClick={() => setEditingSession(null)}>Cancel</ShadcnButton><ShadcnButton type="submit">Save title</ShadcnButton></div></form></DialogContent></Dialog><AlertDialog open={Boolean(deletingSession)} onOpenChange={open => { if (!open) setDeletingSession(null); }}><AlertDialogContent><AlertDialogTitle>Delete this session?</AlertDialogTitle><AlertDialogDescription>This deletes the saved session and its GPX data from this device and, when signed in, your account and other devices. Your explored roads and map progress stay the same.</AlertDialogDescription><div className="mt-5 flex justify-end gap-3"><ShadcnButton variant="ghost" onClick={() => setDeletingSession(null)}>Cancel</ShadcnButton><ShadcnButton variant="destructive" onClick={() => { if (deletingSession) onDelete(deletingSession); setDeletingSession(null); }}>Delete session</ShadcnButton></div></AlertDialogContent></AlertDialog></section>;
}

function LegacyProgressView({ location, discoveries }: { location: LocationState; discoveries: DiscoveredSegment[] }) {
  const [selectedMunicipality, setSelectedMunicipality] = useState('Stockholm');
  const currentDistrict = findStockholmDistrict([location.lng, location.lat]) as NonNullable<ReturnType<typeof findStockholmDistrict>>;
  const currentRegion = currentDistrict ? STOCKHOLM_REGION_BY_DISTRICT.get(currentDistrict.id) : undefined;
  const currentArea = selectedMunicipality === 'Stockholm' ? `Stockholm / ${formatItemText(currentDistrict?.name ?? location.region)}` : selectedMunicipality;
  const municipalityDenominator = aggregateDenominators(STOCKHOLM_DISTRICTS.map(district => district.id));
  const municipalityStats = progressStatsForDenominator(municipalityDenominator, discoveries);
  const recentDistricts = STOCKHOLM_DISTRICTS.map(district => ({ district, lastExploredAt: Math.max(...discoveries.filter(segment => segment.regionId === district.id).map(segment => segment.discoveredAt), 0) })).filter(entry => entry.lastExploredAt > 0).sort((a, b) => b.lastExploredAt - a.lastExploredAt).slice(0, 5);
  return <section className="min-h-[calc(100svh-76px)] overflow-auto bg-surface px-6 pb-32 pt-10 text-text sm:px-8"><div className="mx-auto max-w-3xl"><header><h1 className="font-sans text-title font-semibold tracking-display">Progress</h1><p className="mt-4 max-w-2xl text-body-lg text-text-muted">Track the roads and paths you have uncovered as you ride.</p><label className="municipality-select"><span className="text-label text-text-subtle">Municipality</span><Select aria-label="Municipality" value={selectedMunicipality} onChange={event => setSelectedMunicipality(event.target.value)}>{SWEDEN_MUNICIPALITIES_SORTED.map(municipality => <option key={municipality} value={municipality}>{municipality}</option>)}</Select></label></header>{selectedMunicipality === 'Stockholm' ? <><Item variant="outline" className="mt-10 border-accent bg-accent-muted"><ItemContent><ItemTitle>Current area</ItemTitle><ItemDescription>Stockholm / {formatItemText(currentDistrict?.name ?? location.region)}</ItemDescription></ItemContent><ItemActions><span className="font-mono text-mono-heading font-semibold text-accent">{currentDistrict ? `${progressStatsForDistrict(currentDistrict.id, discoveries).discovered.toFixed(1)}%` : '—'}</span></ItemActions></Item>{recentDistricts.length > 0 && <section className="mt-10"><h2 className="mb-3 font-sans text-heading font-semibold">Recent</h2><div className="space-y-3">{recentDistricts.map(({ district }) => { const districtDiscoveries = discoveries.filter(segment => segment.regionId === district.id); const denominator = STOCKHOLM_ROAD_NETWORK_BY_DISTRICT.get(district.id)?.denominators; const stats = progressStatsForDistrict(district.id, discoveries); return <Item key={district.id} variant="outline"><ItemContent><DistrictProgressContent title={formatItemText(district.name)} distance={denominator ? `${formatDistance(bikeableDiscoveredMeters(districtDiscoveries))} / ${formatDistance(bikeableLengthMeters(denominator))}` : 'Network index not yet built'} percentage={denominator ? `${stats.discovered.toFixed(1)}%` : '—'} stats={stats} /></ItemContent></Item>; })}</div></section>}<section className="mt-10"><h2 className="mb-3 font-sans text-heading font-semibold">All regions &amp; districts</h2><div className="region-progress-list">{STOCKHOLM_REGIONS.map(region => { const districtIds = region.districts.map(district => district.id); const regionDenominator = aggregateDenominators(districtIds); const regionDiscoveries = discoveries.filter(segment => segment.regionId !== undefined && districtIds.includes(segment.regionId)); const regionStats = progressStatsForDenominator(regionDenominator, regionDiscoveries); const current = region.id === currentRegion?.id; return <details key={region.id} className="region-progress-group" open={current}><summary className="region-progress-summary"><DistrictProgressContent title={region.name} distance={`${formatDistance(bikeableDiscoveredMeters(regionDiscoveries))} / ${formatDistance(bikeableLengthMeters(regionDenominator))}`} percentage={`${regionStats.discovered.toFixed(1)}%`} stats={regionStats} /><span className="accordion-chevron" aria-hidden="true" /></summary><div className="region-progress-districts">{region.districts.map(district => { const districtDiscoveries = discoveries.filter(segment => segment.regionId === district.id); const denominator = STOCKHOLM_ROAD_NETWORK_BY_DISTRICT.get(district.id)?.denominators; const stats = progressStatsForDistrict(district.id, discoveries); const districtCurrent = district.id === currentDistrict?.id; return <Item key={district.id} variant={districtCurrent ? 'muted' : 'outline'} className={districtCurrent ? 'border-accent' : ''}><ItemContent><DistrictProgressContent title={formatItemText(district.name)} distance={denominator ? `${formatDistance(bikeableDiscoveredMeters(districtDiscoveries))} / ${formatDistance(bikeableLengthMeters(denominator))}` : 'Network index not yet built'} percentage={denominator ? `${stats.discovered.toFixed(1)}%` : '—'} stats={stats} /></ItemContent></Item>; })}</div></details>; })}</div></section></> : <Item className="mt-10"><ItemContent><ItemTitle>{selectedMunicipality}</ItemTitle><ItemDescription>Network coverage for this municipality is not indexed yet.</ItemDescription></ItemContent></Item>}</div></section>;
  return <section className="min-h-[calc(100svh-76px)] overflow-auto bg-surface px-6 pb-32 pt-10 text-text sm:px-8"><div className="mx-auto max-w-3xl"><header><h1 className="font-sans text-title font-semibold tracking-display">Progress</h1><p className="mt-4 max-w-2xl text-body-lg text-text-muted">Track the roads and paths you have uncovered as you ride.</p><label className="municipality-select"><span className="text-label text-text-subtle">Municipality</span><Select aria-label="Municipality" value={selectedMunicipality} onChange={event => setSelectedMunicipality(event.target.value)}>{SWEDEN_MUNICIPALITIES_SORTED.map(municipality => <option key={municipality} value={municipality}>{municipality}</option>)}</Select></label></header>{selectedMunicipality === 'Stockholm' ? <><Item variant="outline" className="mt-10 border-accent bg-accent-muted"><ItemContent><ItemTitle>Current area</ItemTitle><ItemDescription>Stockholm / {formatItemText(currentDistrict?.name ?? location.region)}</ItemDescription></ItemContent><ItemActions><span className="font-mono text-mono-heading font-semibold text-accent">{currentDistrict ? `${progressStatsForDistrict(currentDistrict.id, discoveries).discovered.toFixed(1)}%` : '—'}</span></ItemActions></Item>{recentDistricts.length > 0 && <section className="mt-10"><h2 className="mb-3 font-sans text-heading font-semibold">Recent</h2><div className="space-y-3">{recentDistricts.map(({ district }) => { const districtDiscoveries = discoveries.filter(segment => segment.regionId === district.id); const denominator = STOCKHOLM_ROAD_NETWORK_BY_DISTRICT.get(district.id)?.denominators; const stats = progressStatsForDistrict(district.id, discoveries); return <Item key={district.id} variant="outline"><ItemContent><DistrictProgressContent title={formatItemText(district.name)} distance={denominator ? `${formatDistance(bikeableDiscoveredMeters(districtDiscoveries))} / ${formatDistance(bikeableLengthMeters(denominator))}` : 'Network index not yet built'} percentage={denominator ? `${stats.discovered.toFixed(1)}%` : '—'} stats={stats} /></ItemContent></Item>; })}</div></section>}<section className="mt-10"><h2 className="mb-3 font-sans text-heading font-semibold">All regions &amp; districts</h2><div className="region-progress-list">{STOCKHOLM_REGIONS.map(region => { const districtIds = region.districts.map(district => district.id); const regionDenominator = aggregateDenominators(districtIds); const regionDiscoveries = discoveries.filter(segment => segment.regionId !== undefined && districtIds.includes(segment.regionId)); const regionStats = progressStatsForDenominator(regionDenominator, regionDiscoveries); const current = region.id === currentRegion?.id; return <details key={region.id} className="region-progress-group" open={current}><summary className="region-progress-summary"><DistrictProgressContent title={region.name} distance={`${formatDistance(bikeableDiscoveredMeters(regionDiscoveries))} / ${formatDistance(bikeableLengthMeters(regionDenominator))}`} percentage={`${regionStats.discovered.toFixed(1)}%`} stats={regionStats} /><span className="accordion-chevron" aria-hidden="true" /></summary><div className="region-progress-districts">{region.districts.map(district => { const districtDiscoveries = discoveries.filter(segment => segment.regionId === district.id); const denominator = STOCKHOLM_ROAD_NETWORK_BY_DISTRICT.get(district.id)?.denominators; const stats = progressStatsForDistrict(district.id, discoveries); const districtCurrent = district.id === currentDistrict?.id; return <Item key={district.id} variant={districtCurrent ? 'muted' : 'outline'} className={districtCurrent ? 'border-accent' : ''}><ItemContent><DistrictProgressContent title={formatItemText(district.name)} distance={denominator ? `${formatDistance(bikeableDiscoveredMeters(districtDiscoveries))} / ${formatDistance(bikeableLengthMeters(denominator))}` : 'Network index not yet built'} percentage={denominator ? `${stats.discovered.toFixed(1)}%` : '—'} stats={stats} /></ItemContent></Item>; })}</div></details>; })}</div></section></> : <Item className="mt-10"><ItemContent><ItemTitle>{selectedMunicipality}</ItemTitle><ItemDescription>Network coverage for this municipality is not indexed yet.</ItemDescription></ItemContent></Item>}</div></section>;
  return <section className="min-h-[calc(100svh-76px)] overflow-auto bg-surface px-6 pb-32 pt-10 text-text sm:px-8"><div className="mx-auto max-w-3xl"><header><h1 className="font-sans text-title font-semibold tracking-display">Progress</h1><p className="mt-4 max-w-2xl text-body-lg text-text-muted">Explore Stockholm by region and district. Track the roads and paths you have uncovered as you ride.</p></header><Item variant="outline" className="mt-10 border-accent bg-accent-muted"><ItemContent><ItemTitle>Current area</ItemTitle><ItemDescription>{currentArea}</ItemDescription></ItemContent><ItemActions><span className="font-mono text-mono-heading font-semibold text-accent">{currentDistrict ? `${progressStatsForDistrict(currentDistrict.id, discoveries).discovered.toFixed(1)}%` : '—'}</span></ItemActions></Item><details className="municipality-progress-group" open><summary className="municipality-progress-summary"><AccordionSummary title={STOCKHOLM_MUNICIPALITY.name} percentage={`${municipalityStats.discovered.toFixed(1)}%`} /></summary><div className="region-progress-list">{STOCKHOLM_REGIONS.map(region => { const districtIds = region.districts.map(district => district.id); const regionDenominator = aggregateDenominators(districtIds); const regionDiscoveries = discoveries.filter(segment => segment.regionId !== undefined && districtIds.includes(segment.regionId)); const regionStats = progressStatsForDenominator(regionDenominator, regionDiscoveries); const current = region.id === currentRegion?.id; return <details key={region.id} className="region-progress-group" open={current}><summary className="region-progress-summary"><DistrictProgressContent title={region.name} distance={`${formatDistance(bikeableDiscoveredMeters(regionDiscoveries))} / ${formatDistance(bikeableLengthMeters(regionDenominator))}`} percentage={`${regionStats.discovered.toFixed(1)}%`} stats={regionStats} /><span className="accordion-chevron" aria-hidden="true" /></summary><div className="region-progress-districts">{region.districts.map(district => { const districtDiscoveries = discoveries.filter(segment => segment.regionId === district.id); const denominator = STOCKHOLM_ROAD_NETWORK_BY_DISTRICT.get(district.id)?.denominators; const stats = progressStatsForDistrict(district.id, discoveries); const districtCurrent = district.id === currentDistrict?.id; return <Item key={district.id} variant={districtCurrent ? 'muted' : 'outline'} className={districtCurrent ? 'border-accent' : ''}><ItemContent><DistrictProgressContent title={formatItemText(district.name)} distance={denominator ? `${formatDistance(bikeableDiscoveredMeters(districtDiscoveries))} / ${formatDistance(bikeableLengthMeters(denominator))}` : 'Network index not yet built'} percentage={denominator ? `${stats.discovered.toFixed(1)}%` : '—'} stats={stats} /></ItemContent></Item>; })}</div></details>; })}</div></details></div></section>;
}

function DistrictProgressCard({ district, discoveries, current, onSelect, cardRef }: { district: StockholmDistrict; discoveries: DiscoveredSegment[]; current: boolean; onSelect?: () => void; cardRef?: React.Ref<HTMLDivElement> }) {
  const districtDiscoveries = discoveries.filter(segment => segment.regionId === district.id);
  const denominator = STOCKHOLM_ROAD_NETWORK_BY_DISTRICT.get(district.id)?.denominators;
  const stats = progressStatsForDistrict(district.id, discoveries);
  return <div ref={cardRef} className="district-progress-card" onClick={onSelect} onKeyDown={event => { if (onSelect && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(); } }} role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined}><Item variant="outline" className={current ? 'district-progress-current' : ''}><ItemContent><DistrictProgressContent title={<span className="inline-flex items-center gap-2">{formatItemText(district.name)}{current && <span className="district-current-badge">Current</span>}</span>} distance={denominator ? `${formatDistance(bikeableDiscoveredMeters(districtDiscoveries))} / ${formatDistance(bikeableLengthMeters(denominator))}` : 'Network index not yet built'} percentage={denominator ? `${stats.discovered.toFixed(1)}%` : '—'} stats={stats} /></ItemContent></Item></div>;
}

function RegionAccordion({ region, discoveries, currentDistrictId, onDistrictSelect, districtRefs }: { region: typeof STOCKHOLM_REGIONS[number]; discoveries: DiscoveredSegment[]; currentDistrictId?: string; onDistrictSelect?: (district: StockholmDistrict) => void; districtRefs?: React.MutableRefObject<Record<string, HTMLDivElement | null>> }) {
  const districtIds = region.districts.map(district => district.id);
  const regionDenominator = aggregateDenominators(districtIds);
  const regionDiscoveries = discoveries.filter(segment => segment.regionId !== undefined && districtIds.includes(segment.regionId));
  const regionStats = progressStatsForDenominator(regionDenominator, regionDiscoveries);
  return <AccordionItem value={region.id} className="region-accordion-item"><AccordionTrigger className="region-accordion-trigger"><div className="region-accordion-summary"><span className="region-accordion-title">{region.name}</span><span className="region-accordion-data"><strong>{regionStats.discovered.toFixed(1)}%</strong></span></div></AccordionTrigger><AccordionContent className="region-accordion-content"><div className="region-progress-districts">{region.districts.map(district => <DistrictProgressCard key={district.id} district={district} discoveries={discoveries} current={district.id === currentDistrictId} onSelect={onDistrictSelect ? () => onDistrictSelect(district) : undefined} cardRef={districtRefs ? element => { districtRefs.current[district.id] = element; } : undefined} />)}</div></AccordionContent></AccordionItem>;
}

function LegacyGlobalProgressView({ location, discoveries }: { location: LocationState; discoveries: DiscoveredSegment[] }) {
  const [selectedMunicipality, setSelectedMunicipality] = useState('Stockholm');
  const currentDistrict = findStockholmDistrict([location.lng, location.lat]) as NonNullable<ReturnType<typeof findStockholmDistrict>>;
  const currentRegion = currentDistrict ? STOCKHOLM_REGION_BY_DISTRICT.get(currentDistrict.id) : undefined;
  const municipalityDenominator = aggregateDenominators(STOCKHOLM_DISTRICTS.map(district => district.id));
  const municipalityStats = progressStatsForDenominator(municipalityDenominator, discoveries);
  const recentDistricts = STOCKHOLM_DISTRICTS.map(district => ({ district, lastExploredAt: Math.max(...discoveries.filter(segment => segment.regionId === district.id).map(segment => segment.discoveredAt), 0) })).filter(entry => entry.lastExploredAt > 0).sort((a, b) => b.lastExploredAt - a.lastExploredAt).slice(0, 5);

  return <section className="min-h-[calc(100svh-76px)] overflow-auto bg-surface px-6 pb-32 pt-10 text-text sm:px-8"><div className="mx-auto max-w-3xl"><header><h1 className="font-sans text-title font-semibold tracking-display">Progress</h1><p className="mt-4 max-w-2xl text-body-lg text-text-muted">Track the roads and paths you have uncovered as you ride.</p><label className="municipality-select"><span className="text-label text-text-subtle">Municipality</span><select value={selectedMunicipality} onChange={event => setSelectedMunicipality(event.target.value)}>{SWEDEN_MUNICIPALITIES.map(municipality => <option key={municipality} value={municipality}>{municipality}</option>)}</select></label></header>{selectedMunicipality === 'Stockholm' ? <><Item variant="outline" className="mt-10 border-accent bg-accent-muted"><ItemContent><ItemTitle>Current area</ItemTitle><ItemDescription>Stockholm / {currentRegion?.name ?? 'Unknown region'} / {formatItemText(currentDistrict?.name ?? location.region)}</ItemDescription></ItemContent><ItemActions><span className="font-mono text-mono-heading font-semibold text-accent">{currentDistrict ? `${progressStatsForDistrict(currentDistrict.id, discoveries).discovered.toFixed(1)}%` : '—'}</span></ItemActions></Item><details className="municipality-progress-group" open><summary className="municipality-progress-summary"><AccordionSummary title="Stockholm" percentage={`${municipalityStats.discovered.toFixed(1)}%`} /></summary><div className="region-progress-list">{STOCKHOLM_REGIONS.map(region => { const districtIds = region.districts.map(district => district.id); const regionDenominator = aggregateDenominators(districtIds); const regionDiscoveries = discoveries.filter(segment => segment.regionId !== undefined && districtIds.includes(segment.regionId)); const regionStats = progressStatsForDenominator(regionDenominator, regionDiscoveries); const current = region.id === currentRegion?.id; return <details key={region.id} className="region-progress-group" open={current}><summary className="region-progress-summary"><DistrictProgressContent title={region.name} distance={`${formatDistance(bikeableDiscoveredMeters(regionDiscoveries))} / ${formatDistance(bikeableLengthMeters(regionDenominator))}`} percentage={`${regionStats.discovered.toFixed(1)}%`} stats={regionStats} /><span className="accordion-chevron" aria-hidden="true" /></summary><div className="region-progress-districts">{region.districts.map(district => { const districtDiscoveries = discoveries.filter(segment => segment.regionId === district.id); const denominator = STOCKHOLM_ROAD_NETWORK_BY_DISTRICT.get(district.id)?.denominators; const stats = progressStatsForDistrict(district.id, discoveries); const districtCurrent = district.id === currentDistrict?.id; return <Item key={district.id} variant={districtCurrent ? 'muted' : 'outline'} className={districtCurrent ? 'border-accent' : ''}><ItemContent><DistrictProgressContent title={formatItemText(district.name)} distance={denominator ? `${formatDistance(bikeableDiscoveredMeters(districtDiscoveries))} / ${formatDistance(bikeableLengthMeters(denominator))}` : 'Network index not yet built'} percentage={denominator ? `${stats.discovered.toFixed(1)}%` : '—'} stats={stats} /></ItemContent></Item>; })}</div></details>; })}</div></details></> : <Item className="mt-10"><ItemContent><ItemTitle>{selectedMunicipality}</ItemTitle><ItemDescription>Network coverage for this municipality is not indexed yet.</ItemDescription></ItemContent></Item>}</div></section>;
}

function LegacyGlobalProgressViewActive({ location, discoveries }: { location: LocationState; discoveries: DiscoveredSegment[] }) {
  const [selectedMunicipality, setSelectedMunicipality] = useState('Stockholm');
  const currentDistrict = findStockholmDistrict([location.lng, location.lat]);
  const currentRegion = currentDistrict ? STOCKHOLM_REGION_BY_DISTRICT.get(currentDistrict.id) : undefined;
  const municipalityDenominator = aggregateDenominators(STOCKHOLM_DISTRICTS.map(district => district.id));
  const municipalityStats = progressStatsForDenominator(municipalityDenominator, discoveries);
  const recentDistricts = STOCKHOLM_DISTRICTS.map(district => ({ district, lastExploredAt: Math.max(...discoveries.filter(segment => segment.regionId === district.id).map(segment => segment.discoveredAt), 0) })).filter(entry => entry.lastExploredAt > 0).sort((a, b) => b.lastExploredAt - a.lastExploredAt).slice(0, 5);

  return <section className="min-h-[calc(100svh-76px)] overflow-auto bg-surface px-6 pb-32 pt-10 text-text sm:px-8"><div className="mx-auto max-w-3xl"><header><h1 className="font-sans text-title font-semibold tracking-display">Progress</h1><p className="mt-4 max-w-2xl text-body-lg text-text-muted">Track the roads and paths you have uncovered as you ride.</p><label className="municipality-select"><span className="text-label text-text-subtle">Municipality</span><Select value={selectedMunicipality} onValueChange={setSelectedMunicipality}><SelectTrigger className="w-full min-h-control text-body-lg"><SelectValue placeholder="Choose a municipality" /></SelectTrigger><SelectContent>{SWEDEN_MUNICIPALITIES_SORTED.map(municipality => <SelectItem key={municipality} value={municipality}>{municipality}</SelectItem>)}</SelectContent></Select></label></header>{selectedMunicipality === 'Stockholm' ? <><Item variant="outline" className="mt-10 border-accent bg-accent-muted"><ItemContent><ItemTitle>Current area</ItemTitle><ItemDescription>Stockholm / {formatItemText(currentDistrict?.name ?? location.region)}</ItemDescription></ItemContent><ItemActions><span className="font-mono text-mono-heading font-semibold text-accent">{currentDistrict ? `${progressStatsForDistrict(currentDistrict.id, discoveries).discovered.toFixed(1)}%` : '—'}</span></ItemActions></Item>{recentDistricts.length > 0 && <section className="mt-10"><h2 className="mb-3 font-sans text-heading font-semibold">Recent</h2><div className="space-y-3">{recentDistricts.map(({ district }) => <DistrictProgressCard key={district.id} district={district} discoveries={discoveries} current={district.id === currentDistrict?.id} />)}</div></section>}<section className="mt-10"><h2 className="mb-3 font-sans text-heading font-semibold">All regions &amp; districts</h2><Accordion multiple defaultValue={currentRegion ? [currentRegion.id] : []} className="region-accordion-list">{STOCKHOLM_REGIONS.map(region => <RegionAccordion key={region.id} region={region} discoveries={discoveries} currentDistrictId={currentDistrict?.id} />)}</Accordion></section></> : <Item className="mt-10"><ItemContent><ItemTitle>{selectedMunicipality}</ItemTitle><ItemDescription>Network coverage for this municipality is not indexed yet.</ItemDescription></ItemContent></Item>}</div></section>;
}

function LegacyGlobalProgressViewCurrent({ location, discoveries }: { location: LocationState; discoveries: DiscoveredSegment[] }) {
  const [selectedMunicipality, setSelectedMunicipality] = useState('Stockholm');
  const currentDistrict = findStockholmDistrict([location.lng, location.lat]);
  const currentRegion = currentDistrict ? STOCKHOLM_REGION_BY_DISTRICT.get(currentDistrict.id) : undefined;
  const municipalityDenominator = aggregateDenominators(STOCKHOLM_DISTRICTS.map(district => district.id));
  const recentDistricts = STOCKHOLM_DISTRICTS.map(district => ({ district, lastExploredAt: Math.max(...discoveries.filter(segment => segment.regionId === district.id).map(segment => segment.discoveredAt), 0) })).filter(entry => entry.lastExploredAt > 0).sort((a, b) => b.lastExploredAt - a.lastExploredAt).slice(0, 5);
  const [openRegions, setOpenRegions] = useState<string[]>(() => currentRegion ? [currentRegion.id] : []);
  const [pendingDistrictId, setPendingDistrictId] = useState<string | null>(null);
  const districtRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!pendingDistrictId) return;
    const region = STOCKHOLM_REGION_BY_DISTRICT.get(pendingDistrictId);
    if (!region || !openRegions.includes(region.id)) return;
    requestAnimationFrame(() => {
      districtRefs.current[pendingDistrictId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setPendingDistrictId(null);
    });
  }, [openRegions, pendingDistrictId]);

  const openRecentDistrict = (district: StockholmDistrict) => {
    const region = STOCKHOLM_REGION_BY_DISTRICT.get(district.id);
    if (!region) return;
    setOpenRegions(previous => previous.includes(region.id) ? previous : [...previous, region.id]);
    setPendingDistrictId(district.id);
  };

  return <section className="min-h-[calc(100svh-76px)] overflow-auto bg-surface px-6 pb-32 pt-10 text-text sm:px-8"><div className="mx-auto max-w-3xl"><header><h1 className="font-sans text-title font-semibold tracking-display">Progress</h1><p className="mt-4 max-w-2xl text-body-lg text-text-muted">Track the roads and paths you have uncovered as you ride.</p><label className="municipality-select"><Select aria-label="Municipality" value={selectedMunicipality} onValueChange={setSelectedMunicipality}><SelectTrigger className="w-full min-h-control text-body-lg"><SelectValue placeholder="Choose a municipality" /></SelectTrigger><SelectContent>{SWEDEN_MUNICIPALITIES_SORTED.map(municipality => <SelectItem key={municipality} value={municipality}>{municipality}</SelectItem>)}</SelectContent></Select></label></header>{selectedMunicipality === 'Stockholm' ? <><section className="mt-10"><h2 className="mb-3 font-sans text-heading font-semibold">Recent districts</h2>{recentDistricts.length > 0 ? <div className="space-y-3">{recentDistricts.map(({ district }) => <DistrictProgressCard key={district.id} district={district} discoveries={discoveries} current={district.id === currentDistrict?.id} onSelect={() => openRecentDistrict(district)} />)}</div> : <p className="text-body text-text-muted">Districts you explore will appear here.</p>}</section><Item variant="outline" className="mt-10 border-accent bg-accent-muted"><ItemContent><ItemTitle>Current area</ItemTitle><ItemDescription>Stockholm / {formatItemText(currentDistrict?.name ?? location.region)}</ItemDescription></ItemContent><ItemActions><span className="font-mono text-mono-heading font-semibold text-accent">{currentDistrict ? `${progressStatsForDistrict(currentDistrict.id, discoveries).discovered.toFixed(1)}%` : '—'}</span></ItemActions></Item><section className="mt-10"><h2 className="mb-3 font-sans text-heading font-semibold">All regions &amp; districts</h2><Accordion multiple value={openRegions} onValueChange={setOpenRegions} className="region-accordion-list">{STOCKHOLM_REGIONS.map(region => <RegionAccordion key={region.id} region={region} discoveries={discoveries} currentDistrictId={currentDistrict?.id} onDistrictSelect={openRecentDistrict} districtRefs={districtRefs} />)}</Accordion></section></> : <Item className="mt-10"><ItemContent><ItemTitle>{selectedMunicipality}</ItemTitle><ItemDescription>Network coverage for this municipality is not indexed yet.</ItemDescription></ItemContent></Item>}</div></section>;
}

function StockholmProgressView({ location, discoveries }: { location: LocationState; discoveries: DiscoveredSegment[] }) {
  const [selectedMunicipality, setSelectedMunicipality] = useState('Stockholm');
  const currentDistrict = findStockholmDistrict([location.lng, location.lat]);
  const currentRegion = currentDistrict ? STOCKHOLM_REGION_BY_DISTRICT.get(currentDistrict.id) : undefined;
  const recentDistricts = STOCKHOLM_DISTRICTS.map(district => ({ district, lastExploredAt: Math.max(...discoveries.filter(segment => segment.regionId === district.id).map(segment => segment.discoveredAt), 0) })).filter(entry => entry.lastExploredAt > 0).sort((a, b) => b.lastExploredAt - a.lastExploredAt).slice(0, 5);
  const [openRegions, setOpenRegions] = useState<string[]>(() => currentRegion ? [currentRegion.id] : []);
  const [pendingDistrictId, setPendingDistrictId] = useState<string | null>(null);
  const districtRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!pendingDistrictId) return;
    const region = STOCKHOLM_REGION_BY_DISTRICT.get(pendingDistrictId);
    if (!region || !openRegions.includes(region.id)) return;
    requestAnimationFrame(() => {
      districtRefs.current[pendingDistrictId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setPendingDistrictId(null);
    });
  }, [openRegions, pendingDistrictId]);

  const openRecentDistrict = (district: StockholmDistrict) => {
    const region = STOCKHOLM_REGION_BY_DISTRICT.get(district.id);
    if (!region) return;
    setOpenRegions(previous => previous.includes(region.id) ? previous : [...previous, region.id]);
    setPendingDistrictId(district.id);
  };

  return <section className="min-h-[calc(100svh-76px)] overflow-auto bg-surface px-6 pb-32 pt-10 text-text sm:px-8"><div className="mx-auto max-w-3xl"><header><h1 className="font-sans text-title font-semibold tracking-display">Progress</h1><p className="mt-4 max-w-2xl text-body-lg text-text-muted">Track the roads and paths you have uncovered as you ride.</p><label className="municipality-select"><Select aria-label="Municipality" value={selectedMunicipality} onValueChange={setSelectedMunicipality}><SelectTrigger className="w-full min-h-control text-body-lg"><SelectValue placeholder="Choose a municipality" /></SelectTrigger><SelectContent>{SWEDEN_MUNICIPALITIES_SORTED.map(municipality => <SelectItem key={municipality} value={municipality}>{municipality}</SelectItem>)}</SelectContent></Select></label></header>{selectedMunicipality === 'Stockholm' ? <>{recentDistricts.length > 0 && <section className="mt-10"><h2 className="mb-3 font-sans text-heading font-semibold">Recent districts</h2><div className="space-y-3">{recentDistricts.map(({ district }) => <DistrictProgressCard key={district.id} district={district} discoveries={discoveries} current={district.id === currentDistrict?.id} onSelect={() => openRecentDistrict(district)} />)}</div></section>}<section className="mt-10"><h2 className="mb-3 font-sans text-heading font-semibold">All regions &amp; districts</h2><Accordion multiple value={openRegions} onValueChange={setOpenRegions} className="region-accordion-list">{STOCKHOLM_REGIONS.map(region => <RegionAccordion key={region.id} region={region} discoveries={discoveries} currentDistrictId={currentDistrict?.id} onDistrictSelect={openRecentDistrict} districtRefs={districtRefs} />)}</Accordion></section></> : <Item className="mt-10"><ItemContent><ItemTitle>{selectedMunicipality}</ItemTitle><ItemDescription>Network coverage for this municipality is not indexed yet.</ItemDescription></ItemContent></Item>}</div></section>;
}

function DesignSystemComponentsPreview() {
  return <section className="min-h-[calc(100svh-76px)] bg-ink-950 px-6 pb-32 pt-8 text-text sm:px-8"><div className="mx-auto max-w-5xl"><h2 className="font-sans text-heading font-semibold">Reusable components</h2><p className="mt-2 max-w-xl text-body text-text-muted">Shared shadcn primitives used across Roam. These are source-owned components and use the project’s Phosphor icon system.</p><div className="mt-8 grid gap-8 lg:grid-cols-2"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">SELECT</p><Surface className="p-4"><Select defaultValue="stockholm"><SelectTrigger className="w-full"><SelectValue placeholder="Choose a municipality" /></SelectTrigger><SelectContent><SelectItem value="stockholm">Stockholm</SelectItem><SelectItem value="gothenburg">Gothenburg</SelectItem><SelectItem value="malmo">Malmö</SelectItem></SelectContent></Select></Surface></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">ACCORDION</p><Surface className="p-4"><Accordion defaultValue={["regions"]}><AccordionItem value="regions"><AccordionTrigger>Regions</AccordionTrigger><AccordionContent><p className="text-body text-text-muted">Expandable content uses the shared shadcn Accordion primitive and its built-in motion states.</p></AccordionContent></AccordionItem><AccordionItem value="districts"><AccordionTrigger>Districts</AccordionTrigger><AccordionContent><p className="text-body text-text-muted">District cards can be composed inside the same reusable pattern.</p></AccordionContent></AccordionItem></Accordion></Surface></div></div></div></section>;
}

function PrimaryNavigation({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  const activeView = view === 'design-system' ? 'settings' : view;
  const items = [{ value: 'map', icon: MapTrifold, label: 'Map' }, { value: 'sessions', icon: Compass, label: 'Sessions' }, { value: 'settings', icon: Gear, label: 'Settings' }] as const;
  return <ShadcnTabs value={activeView} onValueChange={(value) => onChange(value as View)} className="bottom-nav"><TabsList variant="line" className="bottom-nav-list" aria-label="Primary navigation">{items.map((item) => { const Icon = item.icon; return <TabsTrigger key={item.value} value={item.value} className="nav-item"><span className="nav-icon" aria-hidden="true"><Icon /></span><span className="nav-label roam-overline-sm">{item.label}</span></TabsTrigger>; })}</TabsList></ShadcnTabs>;
}

function App() {
  const [view, setView] = useState<View>('map');
  const showDiscovered = true;
  const [showRegionProgress, setShowRegionProgress] = useState(false);
  const [is3D, setIs3D] = useState(false);
  const [showBuildings3D, setShowBuildings3D] = useState(false);
  const [showTerrain3D, setShowTerrain3D] = useState(false);
  const [gpsPermission, setGpsPermission] = useState<GpsPermission>(() => {
    const stored = localStorage.getItem(GPS_PERMISSION_STORAGE_KEY);
    return stored === 'granted' || stored === 'denied' ? stored : 'prompt';
  });
  const [gpsEnabled, setGpsEnabled] = useState(() => localStorage.getItem(GPS_ENABLED_STORAGE_KEY) === 'true');
  const [sessionActive, setSessionActive] = useState(false);
  const sessionActiveRef = useRef(false);
  const sessionLastPositionRef = useRef<Pick<NavigationState, 'lng' | 'lat'> | null>(null);
  const lastProcessedLocationTimestampRef = useRef(0);
  const sessionTrackPointsRef = useRef<RideTrackingPoint[]>([]);
  const sessionDistanceRef = useRef(0);
  const sessionDiscoveredMetersRef = useRef(0);
  const [sessionDistanceMeters, setSessionDistanceMeters] = useState(0);
  const [sessionDiscoveredMeters, setSessionDiscoveredMeters] = useState(0);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [sessionElapsedSeconds, setSessionElapsedSeconds] = useState(0);
  const [activityDrawerHeight, setActivityDrawerHeight] = useState(0);
  const [activityDrawerVisible, setActivityDrawerVisible] = useState(false);
  const activityDrawerRef = useRef<HTMLDivElement | null>(null);
  const [playerLocation, setPlayerLocation] = useState<PlayerLocation | null>(null);
  const navigationRef = useRef<NavigationState | null>(null);
  const [discoveries, setDiscoveries] = useState<DiscoveredSegment[]>([]);
  const [discoveriesLoaded, setDiscoveriesLoaded] = useState(false);
  const discoveriesRef = useRef<DiscoveredSegment[]>([]);
  const [sessions, setSessions] = useState<RideSession[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [initialSyncSettled, setInitialSyncSettled] = useState(!supabase);
  const [sessionNamingWake, setSessionNamingWake] = useState(0);
  const sessionsRef = useRef<RideSession[]>([]);
  const sessionNamingRunningRef = useRef(false);
  const accountSyncAppliedRef = useRef(false);
  const thumbnailWorkerRef = useRef(false);
  const thumbnailAttemptsRef = useRef(new Set<string>());
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  const [thumbnailWake, setThumbnailWake] = useState(0);
  const gpsWatchRef = useRef<CallbackID | null>(null);
  const lastReconciledPointTimestampRef = useRef(0);
  useEffect(() => {
    if (sessionActive) { setActivityDrawerVisible(true); return; }
    if (!activityDrawerVisible) return;
    // Release the layout reservation immediately. The drawer remains mounted
    // only for its slide-out, so the map expands as the drawer leaves instead
    // of exposing a temporary empty strip above the navigation.
    setActivityDrawerHeight(0);
    const timer = window.setTimeout(() => setActivityDrawerVisible(false), 220);
    return () => window.clearTimeout(timer);
  }, [activityDrawerVisible, sessionActive]);
  useEffect(() => {
    if (!activityDrawerVisible) { setActivityDrawerHeight(0); return; }
    const drawer = activityDrawerRef.current;
    if (!drawer) return;
    const updateHeight = () => setActivityDrawerHeight(Math.ceil(drawer.getBoundingClientRect().height));
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(drawer);
    return () => observer.disconnect();
  }, [activityDrawerVisible]);
  const applyDiscoveredSegments = useCallback((segments: DiscoveredSegment[], countTowardSession = true) => {
    const known = new Set(discoveriesRef.current.map(segment => segment.id));
    const additions = assignDiscoveryRegions(segments).filter(segment => !known.has(segment.id));
    if (!additions.length) return [];
    discoveriesRef.current = [...discoveriesRef.current, ...additions];
    void saveDiscoveredSegments(additions).then(() => window.dispatchEvent(new Event('roam:local-progress-changed'))).catch(() => {});
    setDiscoveries(discoveriesRef.current);
    if (countTowardSession && sessionActiveRef.current) {
      sessionDiscoveredMetersRef.current += additions.reduce((total, segment) => total + segment.lengthMeters, 0);
      setSessionDiscoveredMeters(sessionDiscoveredMetersRef.current);
    }
    return additions;
  }, []);
  const processLocationFix = useCallback((fix: { lng: number; lat: number; accuracy: number; timestamp: number; speed?: number | null; bearing?: number | null }) => {
    // Native and WebView providers can report the same underlying GPS fix.
    // Ignoring an already-consumed timestamp prevents double-counted distance.
    if (fix.timestamp <= lastProcessedLocationTimestampRef.current) return;
    lastProcessedLocationTimestampRef.current = fix.timestamp;
    const currentPosition = { lng: fix.lng, lat: fix.lat };
    setGpsPermission('granted');
    if (sessionActiveRef.current) {
      if (sessionLastPositionRef.current) {
        sessionDistanceRef.current += distanceMeters(sessionLastPositionRef.current, currentPosition);
        setSessionDistanceMeters(sessionDistanceRef.current);
      }
      sessionLastPositionRef.current = currentPosition;
      sessionTrackPointsRef.current.push({ ...fix });
      if (sessionTrackPointsRef.current.length > 21600) sessionTrackPointsRef.current.shift();
    }
    const navigation = nextNavigationState(navigationRef.current, {
      ...currentPosition,
      heading: typeof fix.bearing === 'number' && Number.isFinite(fix.bearing) ? fix.bearing : null,
      speed: typeof fix.speed === 'number' && Number.isFinite(fix.speed) ? fix.speed : null,
      timestamp: fix.timestamp,
    });
    navigationRef.current = navigation;
    setPlayerLocation({ ...navigation, accuracy: fix.accuracy });
    localStorage.setItem(LAST_MAP_CENTER_STORAGE_KEY, JSON.stringify({ ...currentPosition, timestamp: fix.timestamp }));
  }, []);
  useEffect(() => {
    if (sessionStartedAt === null) {
      setSessionElapsedSeconds(0);
      return;
    }
    const updateElapsed = () => setSessionElapsedSeconds(Math.max(0, Math.floor((Date.now() - sessionStartedAt) / 1000)));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [sessionStartedAt]);
  useEffect(() => {
    loadDiscoveredSegments().then(async loaded => {
      if (accountSyncAppliedRef.current) return;
      let synchronized = assignDiscoveryRegions(loaded);
      const needsRoadTypeMigration = !localStorage.getItem(DISCOVERY_ROAD_TYPE_MIGRATION_KEY);
      if (needsRoadTypeMigration) {
        synchronized = assignDiscoveryRegions(await synchronizeDiscoveredSegmentRoadTypes(synchronized));
      }
      // Avoid rewriting every discovered segment on each startup. Persist only
      // when migration or region assignment actually changed stored records.
      if (needsRoadTypeMigration || synchronized.some((segment, index) => segment !== loaded[index])) {
        await saveDiscoveredSegments(synchronized);
      }
      if (needsRoadTypeMigration) localStorage.setItem(DISCOVERY_ROAD_TYPE_MIGRATION_KEY, 'done');
      discoveriesRef.current = synchronized;
      setDiscoveries(synchronized);
    }).catch(() => {}).finally(() => setDiscoveriesLoaded(true));
  }, []);
  useEffect(() => {
    loadSessions().then(loaded => {
      if (accountSyncAppliedRef.current) return;
      sessionsRef.current = loaded;
      setSessions(loaded);
    }).catch(() => {}).finally(() => setSessionsLoaded(true));
  }, []);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => {
    const onOnline = () => setSessionNamingWake(value => value + 1);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);
  useEffect(() => {
    if (view !== 'sessions' || !sessionsLoaded || !initialSyncSettled || !navigator.onLine || sessionNamingRunningRef.current) return;
    sessionNamingRunningRef.current = true;
    const migrationKey = `roam-session-names-${SESSION_NAMING_VERSION}`;
    const renamed = JSON.parse(localStorage.getItem(migrationKey) ?? '{}') as Record<string, string>;
    const migrate = async () => {
      const checked = new Set<string>();
      while (true) {
        if (viewRef.current !== 'sessions') break;
        const session = sessionsRef.current.find(candidate => !checked.has(candidate.id));
        if (!session) break;
        checked.add(session.id);
        if (!isGeneratedSessionTitle(session) || session.points.length < 2) continue;
        const signature = `${session.title}|${session.districtNames?.join('|') ?? ''}`;
        if (renamed[session.id] === signature) continue;
        try {
          const hasCurrentNames = session.districtNames.length > 0 && session.districtNames.every(name => shortRegionName(name) !== name || / (?:kommun|län)$/.test(name));
          const districtNames = hasCurrentNames ? session.districtNames : await regionNamesForSession(session.points);
          if (!districtNames.length) continue;
          const current = sessionsRef.current.find(candidate => candidate.id === session.id);
          if (!current || current.title !== session.title || !isGeneratedSessionTitle(current)) continue;
          const updated = { ...current, districtNames, title: titleForRegions(districtNames) };
          if (updated.title !== current.title || updated.districtNames.join('|') !== current.districtNames.join('|')) {
            await saveSession(updated);
            sessionsRef.current = sessionsRef.current.map(candidate => candidate.id === updated.id ? updated : candidate);
            setSessions(sessionsRef.current);
            window.dispatchEvent(new Event('roam:local-progress-changed'));
          }
          renamed[session.id] = `${updated.title}|${updated.districtNames.join('|')}`;
          localStorage.setItem(migrationKey, JSON.stringify(renamed));
        } catch {
          // Retry unavailable area lookups when Sessions is opened again.
        }
      }
    };
    void migrate().finally(() => { sessionNamingRunningRef.current = false; });
  }, [view, sessionsLoaded, initialSyncSettled, sessionNamingWake]);
  useEffect(() => {
    if (!supabase || !discoveriesLoaded || !sessionsLoaded) return;
    let disposed = false;
    let userId: string | null = null;
    let running = false;
    let queued = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sync = async () => {
      if (disposed || !userId || !navigator.onLine || document.visibilityState === 'hidden') {
        if (!userId || !navigator.onLine) setInitialSyncSettled(true);
        return;
      }
      if (running) { queued = true; return; }
      running = true;
      const accountId = userId;
      try {
        await runAccountSync(accountId);
      } catch {
        // Offline and server failures are retried on the next trigger.
      } finally {
        running = false;
        if (!disposed) setInitialSyncSettled(true);
        if (queued) { queued = false; schedule(500); }
      }
    };
    const schedule = (delay = 1500) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void sync(); }, delay);
    };
    const onAuth = (id: string | null) => {
      const accountChanged = userId !== id;
      userId = id;
      if (id) {
        if (accountChanged) setInitialSyncSettled(false);
        schedule(0);
      }
      else setInitialSyncSettled(true);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => onAuth(session?.user.id ?? null));
    void supabase.auth.getUser().then(({ data }) => onAuth(data.user?.id ?? null)).catch(() => setInitialSyncSettled(true));
    const onVisible = () => { if (document.visibilityState === 'visible') schedule(0); };
    const onChanged = () => schedule();
    const onOnline = () => schedule(0);
    window.addEventListener('online', onOnline);
    window.addEventListener('roam:local-progress-changed', onChanged);
    document.addEventListener('visibilitychange', onVisible);
    const interval = window.setInterval(() => schedule(0), 60_000);
    return () => { disposed = true; if (timer) clearTimeout(timer); clearInterval(interval); subscription.unsubscribe(); window.removeEventListener('online', onOnline); window.removeEventListener('roam:local-progress-changed', onChanged); document.removeEventListener('visibilitychange', onVisible); };
  }, [discoveriesLoaded, sessionsLoaded]);
  useEffect(() => {
    const applyAccountSync = (event: Event) => {
      const result = (event as CustomEvent<{ discoveries: DiscoveredSegment[]; sessions: RideSession[]; addedDiscoveryMeters?: number; addedRides?: number }>).detail;
      if (!result) return;
      const additions = [
        result.addedDiscoveryMeters ? `${formatDistance(result.addedDiscoveryMeters)} of explored roads` : null,
        result.addedRides ? `${result.addedRides} ${result.addedRides === 1 ? 'ride' : 'rides'}` : null,
      ].filter(Boolean);
      if (additions.length) toastManager.add({ title: 'New progress loaded', description: `Added ${additions.join(' and ')} from your other devices.`, data: { kind: 'success' } });
      accountSyncAppliedRef.current = true;
      discoveriesRef.current = result.discoveries;
      sessionsRef.current = result.sessions;
      setDiscoveries(result.discoveries);
      setSessions(result.sessions);
      setSessionNamingWake(value => value + 1);
    };
    window.addEventListener('roam:account-sync-complete', applyAccountSync);
    return () => window.removeEventListener('roam:account-sync-complete', applyAccountSync);
  }, []);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') setThumbnailWake(value => value + 1); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  useEffect(() => {
    if (view !== 'sessions' || document.visibilityState !== 'visible' || thumbnailWorkerRef.current) return;
    thumbnailWorkerRef.current = true;
    const generateQueuedThumbnails = async () => {
      try {
        while (viewRef.current === 'sessions' && document.visibilityState === 'visible') {
          const next = sessionsRef.current.find(session => session.points.length > 1 && (!session.thumbnail || session.thumbnailStyleVersion !== SESSION_THUMBNAIL_STYLE_VERSION) && !thumbnailAttemptsRef.current.has(session.id));
          if (!next) break;
          thumbnailAttemptsRef.current.add(next.id);
          const thumbnail = await generateSessionThumbnail(next.points);
          if (thumbnail) {
            const updated = { ...next, thumbnail, thumbnailStyleVersion: SESSION_THUMBNAIL_STYLE_VERSION };
            await saveSession(updated);
            setSessions(current => current.map(session => session.id === updated.id ? updated : session));
          }
          await new Promise(resolve => window.setTimeout(resolve, 350));
        }
      } finally { thumbnailWorkerRef.current = false; }
    };
    window.setTimeout(() => { void generateQueuedThumbnails(); }, 500);
  }, [sessions, thumbnailWake, view]);
  useEffect(() => {
    // Capacitor exposes Android permissions through its plugin; the browser
    // Permissions API remains useful for keeping the web UI in sync.
    Geolocation.checkPermissions().then((status) => {
      setGpsPermission(status.location === 'granted' ? 'granted' : status.location === 'denied' ? 'denied' : 'prompt');
    }).catch(() => {});
    if (!navigator.permissions?.query) return;
    let permissionStatus: PermissionStatus | null = null;
    navigator.permissions.query({ name: 'geolocation' }).then((status) => {
      permissionStatus = status;
      setGpsPermission(status.state === 'granted' || status.state === 'denied' ? status.state : 'prompt');
      status.onchange = () => setGpsPermission(status.state === 'granted' || status.state === 'denied' ? status.state : 'prompt');
    }).catch(() => {});
    return () => { if (permissionStatus) permissionStatus.onchange = null; };
  }, []);
  useEffect(() => {
    if (!gpsEnabled) {
      if (gpsWatchRef.current !== null) void Geolocation.clearWatch({ id: gpsWatchRef.current });
      gpsWatchRef.current = null;
      if (!gpsEnabled) { navigationRef.current = null; setPlayerLocation(null); }
      return;
    }
    let disposed = false;
    const handlePosition = (position: Position) => {
      if (disposed) return;
      processLocationFix({ lng: position.coords.longitude, lat: position.coords.latitude, accuracy: position.coords.accuracy, bearing: position.coords.heading, speed: position.coords.speed, timestamp: position.timestamp });
    };
    const handleError = (error: unknown) => {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: number }).code === 1) {
        setGpsPermission('denied');
        setGpsEnabled(false);
        localStorage.setItem(GPS_PERMISSION_STORAGE_KEY, 'denied');
      }
    };
    // During a native recording the foreground service owns GPS. Keeping this
    // WebView watch off avoids competing subscriptions and duplicate fixes.
    if (Capacitor.isNativePlatform() && sessionActive) return () => { disposed = true; };
    void Geolocation.watchPosition({ enableHighAccuracy: true, maximumAge: 2000, timeout: 15000, minimumUpdateInterval: 2000, interval: 2000 }, (position, error) => {
      if (disposed) return;
      if (position) handlePosition(position);
      if (error) handleError(error);
    }).then((watchId) => {
      if (disposed) void Geolocation.clearWatch({ id: watchId });
      else gpsWatchRef.current = watchId;
    }).catch(handleError);
    return () => { disposed = true; if (gpsWatchRef.current !== null) void Geolocation.clearWatch({ id: gpsWatchRef.current }); gpsWatchRef.current = null; };
  }, [gpsEnabled, processLocationFix, sessionActive]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let disposed = false;
    const restoreNativeRide = async () => {
      try {
        const state = await RideTracking.getState();
        if (disposed || !state.active) return;
        sessionActiveRef.current = true;
        setSessionActive(true);
        setSessionStartedAt(state.startedAt ?? Date.now());
        setGpsEnabled(true);
        localStorage.setItem(GPS_ENABLED_STORAGE_KEY, 'true');
      } catch { /* The map remains usable if the optional native plugin is unavailable. */ }
    };
    void restoreNativeRide();
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !sessionActive) return;
    let disposed = false;
    let draining = false;
    const drainNativePoints = async () => {
      if (disposed || draining) return;
      draining = true;
      try {
        const { points } = await RideTracking.drainPoints();
        if (!disposed) points
          .filter((point): point is RideTrackingPoint => Number.isFinite(point.lat) && Number.isFinite(point.lng) && Number.isFinite(point.timestamp))
          .sort((a, b) => a.timestamp - b.timestamp)
          .forEach(processLocationFix);
      } catch { /* Keep the foreground service recording; a later drain can recover its queue. */ }
      finally { draining = false; }
    };
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') void drainNativePoints(); };
    void drainNativePoints();
    const timer = window.setInterval(() => void drainNativePoints(), 2000);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => { disposed = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibilityChange); };
  }, [processLocationFix, sessionActive]);
  useEffect(() => {
    if (!sessionActive) return;
    let disposed = false;
    let reconciling = false;
    const reconcilePendingTrack = async () => {
      if (disposed || reconciling || document.visibilityState !== 'visible') return;
      reconciling = true;
      try {
        const nativePoints = Capacitor.isNativePlatform() ? (await RideTracking.getRecordedRoute()).points : [];
        const route = (nativePoints.length > 0 ? nativePoints : sessionTrackPointsRef.current)
          .filter((point): point is RideTrackingPoint => Number.isFinite(point.lat) && Number.isFinite(point.lng) && Number.isFinite(point.timestamp))
          .slice()
          .sort((a, b) => a.timestamp - b.timestamp);
        const firstNewIndex = route.findIndex(point => point.timestamp > lastReconciledPointTimestampRef.current);
        if (firstNewIndex < 0) return;
        // Retain one prior fix so the corridor joins cleanly to the last batch.
        const pending = route.slice(Math.max(0, firstNewIndex - 1));
        if (pending.length < 2) return;
        const additions = await reconcileSessionRoute(pending, new Set(discoveriesRef.current.map(segment => segment.id)));
        if (!disposed) {
          applyDiscoveredSegments(additions);
          lastReconciledPointTimestampRef.current = pending.at(-1)!.timestamp;
        }
      } catch {
        // Retain the cursor: a later foreground pass or the final pass retries it.
      } finally {
        reconciling = false;
      }
    };
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') void reconcilePendingTrack(); };
    void reconcilePendingTrack();
    const timer = window.setInterval(() => void reconcilePendingTrack(), 30_000);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => { disposed = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibilityChange); };
  }, [applyDiscoveredSegments, sessionActive]);
  const handleGpsChange = (enabled: boolean, startBackgroundRide = false) => {
    if (!enabled) {
      setGpsEnabled(false);
      navigationRef.current = null;
      setPlayerLocation(null);
      localStorage.setItem(GPS_ENABLED_STORAGE_KEY, 'false');
      if (Capacitor.isNativePlatform()) void RideTracking.stop().catch(() => {});
      return;
    }
    if (!Capacitor.isNativePlatform()) {
      navigator.geolocation.getCurrentPosition(() => {
        setGpsPermission('granted');
        setGpsEnabled(true);
        localStorage.setItem(GPS_PERMISSION_STORAGE_KEY, 'granted');
        localStorage.setItem(GPS_ENABLED_STORAGE_KEY, 'true');
        if (startBackgroundRide) void RideTracking.start().catch(() => {});
      }, (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setGpsPermission('denied');
          localStorage.setItem(GPS_PERMISSION_STORAGE_KEY, 'denied');
          setSessionActive(false);
        }
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
      return;
    }
    void Geolocation.requestPermissions({ permissions: ['location'] }).then((status) => {
      if (status.location !== 'granted') throw new Error('Location permission was not granted');
      // Start the foreground service as soon as permission is available. This
      // closes the small gap where a rider can lock the phone while the initial
      // one-off WebView GPS request is still waiting for its first fix.
      if (startBackgroundRide) void RideTracking.start().catch(() => {});
      return Geolocation.getCurrentPosition({ enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    }).then(() => {
      setGpsPermission('granted');
      setGpsEnabled(true);
      localStorage.setItem(GPS_PERMISSION_STORAGE_KEY, 'granted');
      localStorage.setItem(GPS_ENABLED_STORAGE_KEY, 'true');
    }).catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: number }).code === 1) {
        setGpsPermission('denied');
        localStorage.setItem(GPS_PERMISSION_STORAGE_KEY, 'denied');
        setSessionActive(false);
      }
    });
  };
  const handleSessionChange = (active: boolean) => {
    const startedAt = sessionStartedAt;
    sessionActiveRef.current = active;
    setSessionActive(active);
    setSessionStartedAt(active ? Date.now() : null);
    sessionLastPositionRef.current = null;
    if (active) {
      setSessionDistanceMeters(0);
      setSessionDiscoveredMeters(0);
      sessionTrackPointsRef.current = [];
      sessionDistanceRef.current = 0;
      sessionDiscoveredMetersRef.current = 0;
      lastReconciledPointTimestampRef.current = 0;
    } else if (startedAt !== null) {
      const finishSession = async () => {
        const endedAt = Date.now();
        const nativePoints = Capacitor.isNativePlatform() ? (await RideTracking.getRecordedRoute()).points : [];
        const points = (nativePoints.length > 0 ? nativePoints : sessionTrackPointsRef.current).slice().sort((a, b) => a.timestamp - b.timestamp);
        const durationSeconds = Math.floor((endedAt - startedAt) / 1000);
        if (durationSeconds < 30 || points.length < 2) return;
        const districtNames = await regionNamesForSession(points).catch(() => []);
        const title = titleForRegions(districtNames);
        // Reconcile the complete native track after the ride. While the app is
        // backgrounded the WebView cannot query MapLibre tiles for every GPS
        // fix, so this fills the short gaps from the same detailed road map.
        const reconciled = await reconcileSessionRoute(points, new Set(discoveriesRef.current.map(segment => segment.id))).catch(() => []);
        const reconciledMeters = applyDiscoveredSegments(reconciled, false).reduce((total, segment) => total + segment.lengthMeters, 0);
        const session: RideSession = { id: crypto.randomUUID(), title, districtNames, startedAt, endedAt, durationSeconds, distanceMeters: sessionDistanceRef.current, newDistanceMeters: sessionDiscoveredMetersRef.current + reconciledMeters, points };
        await saveSession(session);
        setSessions(current => [session, ...current]);
        window.dispatchEvent(new Event('roam:local-progress-changed'));
      };
      void finishSession().catch(() => {});
    }
    if (active) handleGpsChange(true, true);
    else if (Capacitor.isNativePlatform()) void RideTracking.stop().catch(() => {});
  };
  const handleGpxExport = (session: RideSession) => {
    const exportRoute = async () => {
      try {
        const fileName = `roam-ride-${new Date(session.startedAt).toISOString().slice(0, 10)}.gpx`;
        const contents = gpxDocument(session.points);
        if (Capacitor.isNativePlatform()) await RideTracking.shareGpx({ contents, fileName });
        else downloadGpx(contents, fileName);
        toastManager.add({ title: 'GPX ready', description: 'Your ride is ready to save or share.', data: { kind: 'success' } });
      } catch { toastManager.add({ title: 'GPX export failed', description: 'Could not create the GPX file. Try again.', priority: 'high', data: { kind: 'error' } }); }
    };
    void exportRoute();
  };
  const handleSessionRename = (session: RideSession, title: string) => {
    const updated = { ...session, title };
    void saveSession(updated).then(() => {
      setSessions(current => current.map(candidate => candidate.id === updated.id ? updated : candidate));
      window.dispatchEvent(new Event('roam:local-progress-changed'));
    }).catch(() => {});
  };
  const handleSessionDelete = (session: RideSession) => {
    void deleteSession(session.id).then(() => {
      setSessions(current => current.filter(candidate => candidate.id !== session.id));
      window.dispatchEvent(new Event('roam:local-progress-changed'));
    }).catch(() => {});
  };
  const handleGpxImport = async (file: File) => {
    const { points, title: gpxTitle } = pointsFromGpx(await file.text());
    const startedAt = points[0]!.timestamp;
    const endedAt = Math.max(startedAt, points.at(-1)!.timestamp);
    const districtNames = await regionNamesForSession(points).catch(() => []);
    const title = gpxTitle ?? titleForRegions(districtNames, file.name.replace(/\.gpx$/i, '').trim() || 'Imported ride');
    let reconciled: DiscoveredSegment[] = [];
    let mapSyncFailed = false;
    try { reconciled = await reconcileSessionRoute(points, new Set(discoveriesRef.current.map(segment => segment.id))); }
    catch { mapSyncFailed = true; }
    const additions = applyDiscoveredSegments(assignDiscoveryRegions(reconciled), false);
    const distanceMetersTotal = points.slice(1).reduce((total, point, index) => total + distanceMeters(points[index]!, point), 0);
    const session: RideSession = {
      id: crypto.randomUUID(),
      title,
      districtNames,
      startedAt,
      endedAt,
      durationSeconds: Math.max(0, Math.floor((endedAt - startedAt) / 1000)),
      distanceMeters: distanceMetersTotal,
      newDistanceMeters: additions.reduce((total, segment) => total + segment.lengthMeters, 0),
      points,
    };
    await saveSession(session);
    setSessions(current => [session, ...current].sort((a, b) => b.startedAt - a.startedAt));
    window.dispatchEvent(new Event('roam:local-progress-changed'));
    return mapSyncFailed ? `Imported ${formatSessionTitle(title)}. Its route could not be added to the map right now.` : `Imported ${formatSessionTitle(title)} and synced its route to the map.`;
  };
  const handleDiscoveries = (newSegments: DiscoveredSegment[]) => {
    applyDiscoveredSegments(newSegments);
  };
  const handleCloudRefresh = async () => {
    if (!supabase) throw new Error('Cloud sync is not configured.');
    if (!navigator.onLine) throw new Error('You are offline. Pull down to try again when connected.');
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!data.user) throw new Error('Sign in from Settings to refresh from the cloud.');
    await runAccountSync(data.user.id);
  };
  return <main className="app-shell" style={{ '--activity-drawer-height': `${activityDrawerHeight}px` } as CSSProperties}><div className="app-content"><MapView active={view === 'map'} onRequestLocation={() => handleGpsChange(true)} sessionActive={sessionActive} onSessionChange={handleSessionChange} activityDrawerHeight={activityDrawerHeight} showDiscovered={showDiscovered} showRegionProgress={showRegionProgress} setShowRegionProgress={setShowRegionProgress} is3D={is3D} setIs3D={setIs3D} showBuildings3D={showBuildings3D} setShowBuildings3D={setShowBuildings3D} showTerrain3D={showTerrain3D} setShowTerrain3D={setShowTerrain3D} showDebugMenu playerLocation={playerLocation} discoveries={discoveries} discoveriesLoaded={discoveriesLoaded} initialSyncSettled={initialSyncSettled} onDiscoveries={handleDiscoveries} />{view === 'sessions' && <SessionsView sessions={sessions} onExport={handleGpxExport} onRename={handleSessionRename} onDelete={handleSessionDelete} onImportGpx={handleGpxImport} onRefresh={handleCloudRefresh} />}{view === 'settings' && <SettingsView showBuildings3D={showBuildings3D} setShowBuildings3D={setShowBuildings3D} showTerrain3D={showTerrain3D} setShowTerrain3D={setShowTerrain3D} gpsEnabled={gpsEnabled} gpsPermission={gpsPermission} onGpsChange={handleGpsChange} onOpenDesignSystem={() => setView('design-system')} />}{view === 'design-system' && <DesignSystemView onBack={() => setView('settings')} />}</div>{activityDrawerVisible && <div ref={activityDrawerRef} className={`activity-drawer ${sessionActive ? 'activity-drawer--open' : 'activity-drawer--closing'}`}><div className="activity-drawer-copy"><span className="roam-overline-sm activity-drawer-title">Active session</span><div className="activity-drawer-stats font-mono"><span className="activity-drawer-timer">{formatSessionTime(sessionElapsedSeconds)}</span><span className="activity-drawer-separator" aria-hidden="true">·</span><span className="activity-drawer-distance">{formatDistance(sessionDistanceMeters)}</span><span className="activity-drawer-new-distance">({formatDistance(sessionDiscoveredMeters)} new)</span></div></div>{sessionActive && <ShadcnButton variant="destructive" className="hover:!border-danger-500 active:!border-danger-500" onClick={() => handleSessionChange(false)}>Stop</ShadcnButton>}</div>}<PrimaryNavigation view={view} onChange={setView} /><Toaster /></main>;
}

const rootElement = document.getElementById('root')!;
const rootWindow = window as Window & { __roamRoot?: ReturnType<typeof createRoot> };
const root = rootWindow.__roamRoot ?? createRoot(rootElement);
rootWindow.__roamRoot = root;
root.render(<StrictMode><App /></StrictMode>);
