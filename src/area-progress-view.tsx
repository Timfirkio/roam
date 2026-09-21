import { useEffect, useMemo, useRef, useState } from 'react';
import { calculateArea, loadArea, lookupAreas } from './area-client';
import { exploredAreaTotals } from './area-geometry';
import type { AreaRecord } from './area-types';
import type { DiscoveredSegment } from './discovery';
import { Button } from './components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from './components/ui/item';
import { Spinner } from './components/ui/spinner';

const distance = (meters: number) => `${(meters / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`;
const message = (error: unknown) => error instanceof Error ? error.message : 'Could not load area coverage. Try again.';

function AreaCoverageCard({ record, discoveries, onUpdate }: { record: AreaRecord; discoveries: DiscoveredSegment[]; onUpdate: (record: AreaRecord) => void }) {
  const { area, job } = record;
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const explored = useMemo(() => area.geometry ? exploredAreaTotals(discoveries, area.geometry).lengthMeters : null, [discoveries, area.geometry]);
  const ready = job?.status === 'ready' && job.totals;
  const percentage = ready && explored !== null && ready.lengthMeters > 0 ? explored / ready.lengthMeters * 100 : null;
  const inconsistent = percentage !== null && percentage > 100.1;
  const pending = job?.status === 'queued' || job?.status === 'running';
  async function calculate() {
    setRequesting(true); setError(null);
    try { onUpdate(await calculateArea(area.id)); } catch (cause) { setError(message(cause)); }
    finally { setRequesting(false); }
  }
  return <Item variant="outline" className="flex-col items-stretch sm:flex-row sm:items-center">
    <ItemContent className="min-w-0">
      <ItemTitle className="line-clamp-none">{area.name}</ItemTitle>
      <ItemDescription>{area.label}</ItemDescription>
      <p className="text-body text-text-muted">
        {explored !== null ? `${distance(explored)} explored` : 'Explored distance available after calculation'}
        {ready ? ` · ${distance(ready.lengthMeters)} mapped roads` : ' · Total not calculated'}
      </p>
      <div role="status" className="text-body text-text-subtle">
        {pending && <span className="inline-flex items-center gap-2"><Spinner />{job.status === 'queued' ? 'Queued' : `Calculating · ${job.completedTiles} of ${job.totalTiles} tiles`}</span>}
        {job?.status === 'failed' && <span>{job.error ?? 'Calculation failed. Retry to resume.'}</span>}
        {ready && ready.lengthMeters === 0 && 'No eligible roads in this map snapshot.'}
        {inconsistent && 'The saved discoveries and current map differ. Coverage needs reconciliation.'}
        {error && <span>{error}</span>}
      </div>
    </ItemContent>
    <ItemActions className="justify-between sm:justify-end">
      {percentage !== null && !inconsistent && <span className="font-mono text-mono-heading font-semibold text-accent" aria-label={`${area.name}: approximately ${Math.min(100, percentage).toFixed(1)} percent explored`}>≈{Math.min(100, percentage).toFixed(1)}%</span>}
      <Button variant={ready ? 'ghost' : 'secondary'} size="large" disabled={pending || requesting} onClick={() => void calculate()}>{requesting ? <Spinner /> : null}{ready ? 'Refresh coverage' : job?.status === 'failed' ? 'Retry calculation' : 'Calculate coverage'}</Button>
    </ItemActions>
  </Item>;
}

export function AreaProgressView({ location, discoveries }: { location: { lng: number; lat: number }; discoveries: DiscoveredSegment[] }) {
  const [point, setPoint] = useState(location);
  const [records, setRecords] = useState<AreaRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const hasNearbyDiscovery = discoveries.some(segment => segment.geometry.coordinates.some(([lng, lat]) => Math.abs(lng - point.lng) < 0.01 && Math.abs(lat - point.lat) < 0.01));
  const recent = useMemo(() => {
    const cells = new Set<string>();
    return [...discoveries].sort((a, b) => b.discoveredAt - a.discoveredAt).filter(segment => {
      const [lng, lat] = segment.geometry.coordinates[0];
      const cell = `${Math.floor(lng * 20)},${Math.floor(lat * 20)}`;
      if (cells.has(cell) || cells.size >= 8) return false;
      cells.add(cell); return true;
    });
  }, [discoveries]);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    setLoading(true); setError(null); setRecords([]);
    void lookupAreas(point.lng, point.lat, controller.signal).then(async result => {
      if (current !== generation.current) return;
      setRecords(result.areas);
      // Only the smallest available local area may be prepared automatically.
      // The backend checks tile cost before scheduling it.
      const smallest = result.areas.at(-1);
      if (smallest && smallest.area.adminLevel >= 7 && !smallest.job && hasNearbyDiscovery) {
        const record = await calculateArea(smallest.area.id, true, controller.signal);
        if (current === generation.current) setRecords(previous => previous.map(r => r.area.id === record.area.id ? record : r));
      }
    }).catch(cause => { if (!controller.signal.aborted) setError(message(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); generation.current++; };
  }, [point.lng, point.lat, revision, hasNearbyDiscovery]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const pending = recordsRef.current.filter(r => r.job?.status === 'running' || r.job?.status === 'queued');
      try {
        const updates = await Promise.all(pending.map(r => loadArea(r.area.id, controller.signal)));
        if (!controller.signal.aborted && updates.length) setRecords(previous => previous.map(r => updates.find(u => u.area.id === r.area.id) ?? r));
      } catch (cause) { if (!controller.signal.aborted) setError(message(cause)); }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 3000);
    }
    timer = setTimeout(() => void poll(), 3000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [point.lng, point.lat, revision]);

  return <section className="mx-auto max-w-3xl space-y-6 px-6 pb-32 pt-8 text-text sm:px-8">
    <header><h1 className="text-title font-semibold tracking-display">Area progress</h1><p className="mt-4 text-body-lg text-text-muted">Explore the smallest local areas, or calculate coverage for a larger region.</p></header>
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="large" onClick={() => { setPoint(location); setRevision(value => value + 1); }}>Current map location</Button>
      {recent.map((segment, index) => <Button key={segment.id} variant="ghost" size="large" onClick={() => { const [lng, lat] = segment.geometry.coordinates[0]; setPoint({ lng, lat }); }}>
        {segment.regionName ?? `Explored area ${index + 1}`}
      </Button>)}
    </div>
    <p className="text-label text-text-subtle">{point.lat.toFixed(4)}, {point.lng.toFixed(4)} · OpenStreetMap administrative areas</p>
    {loading && <p role="status" className="inline-flex items-center gap-2 text-body"><Spinner />Finding area coverage…</p>}
    {error && <Item variant="muted"><ItemContent><ItemTitle>Area coverage unavailable</ItemTitle><p role="alert" className="text-body text-text-muted">{error}</p></ItemContent><ItemActions><Button variant="secondary" size="large" onClick={() => setRevision(value => value + 1)}>Try again</Button></ItemActions></Item>}
    {!loading && !error && !records.length && <p className="text-body text-text-muted">No administrative boundaries were found here. Try another location.</p>}
    <div className="space-y-3">{[...records].reverse().map(record => <AreaCoverageCard key={`${point.lng}/${point.lat}/${record.area.id}`} record={record} discoveries={discoveries} onUpdate={update => setRecords(previous => previous.map(r => r.area.id === update.area.id ? update : r))} />)}</div>
    {records.length > 0 && <p className="text-label text-text-subtle">Coverage is approximate, based on saved discoveries and a versioned road map. Missing neighbourhood boundaries use the enclosing administrative area. Overlapping areas are calculated separately.</p>}
  </section>;
}
