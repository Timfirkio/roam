import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type View = 'map' | 'sessions' | 'progress';

const roads = [
  { d: 'M -40 610 C 190 500 260 390 500 370 S 820 340 1090 80', kind: 'paved', size: 'arterial', found: true },
  { d: 'M 120 -30 C 150 150 330 230 500 370 S 820 500 980 760', kind: 'paved', size: 'throughfare', found: false },
  { d: 'M 36 670 C 230 580 350 550 500 520 S 770 445 1030 470', kind: 'gravel', size: 'side', found: true },
  { d: 'M 70 120 C 180 180 270 190 360 250 S 520 340 700 300', kind: 'paved', size: 'side', found: false },
  { d: 'M 380 760 C 410 630 480 565 500 370 S 590 150 730 30', kind: 'gravel', size: 'track', found: false },
  { d: 'M 520 520 C 620 530 685 600 745 690', kind: 'paved', size: 'track', found: true },
  { d: 'M 500 370 C 615 385 700 360 790 280 S 900 200 980 185', kind: 'paved', size: 'side', found: true },
  { d: 'M 230 410 C 330 350 355 290 360 250', kind: 'gravel', size: 'track', found: false },
];

function MapCanvas() {
  return <div className="map-canvas" aria-label="Abstract road map showing explored and unexplored roads">
    <div className="map-grid" />
    <svg className="road-map" viewBox="0 0 1000 720" preserveAspectRatio="none" role="img">
      <defs><filter id="road-glow"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      {roads.map((road, index) => <path key={index} d={road.d} className={`road road--${road.kind} road--${road.size} ${road.found ? 'road--found' : 'road--hidden'}`} filter={road.found ? 'url(#road-glow)' : undefined} />)}
      <circle className="position-halo" cx="500" cy="370" r="18" /><circle className="position-dot" cx="500" cy="370" r="5" />
    </svg>
    <div className="map-coordinates"><span>59°20' N</span><span>18°04' E</span></div><div className="map-scale">100 M</div>
  </div>;
}

function MapView() {
  const [tracking, setTracking] = useState(false);
  return <section className="map-view"><MapCanvas />
    <header className="map-header"><div className="wordmark">ROAM<span>/01</span></div><div className="header-status"><i className={tracking ? 'status-dot status-dot--live' : 'status-dot'} />{tracking ? 'TRACKING' : 'READY'}</div></header>
    <div className="map-topline"><span>STOCKHOLM / SÖDERMALM</span><span>42.8% REVEALED</span></div>
    <div className="map-controls" aria-label="Map controls"><button type="button" aria-label="Zoom in">+</button><button type="button" aria-label="Zoom out">−</button><button type="button" aria-label="Center on location">◎</button></div>
    <div className="map-legend"><span><b className="legend-line legend-line--paved" />PAVED</span><span><b className="legend-line legend-line--gravel" />GRAVEL</span><span><b className="legend-line legend-line--hidden" />UNEXPLORED</span></div>
    <div className="session-dock"><div><span className="dock-label">CURRENT SESSION</span><strong>{tracking ? '00:00:18' : 'NO ACTIVE SESSION'}</strong></div><button className={`track-button ${tracking ? 'track-button--active' : ''}`} type="button" onClick={() => setTracking(!tracking)}><span className="track-button__icon">{tracking ? '■' : '▶'}</span>{tracking ? 'END SESSION' : 'START ROAMING'}</button></div>
  </section>;
}

function PlaceholderView({ title, eyebrow, copy }: { title: string; eyebrow: string; copy: string }) { return <section className="placeholder-view"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p><div className="empty-state">MODULE READY<br /><span>Next build slice</span></div></section>; }

function App() {
  const [view, setView] = useState<View>('map');
  return <main className="app-shell"><div className="app-content">{view === 'map' && <MapView />}{view === 'sessions' && <PlaceholderView eyebrow="ROAM / SESSIONS" title="Sessions" copy="A record of every route you take. Session summaries will live here." />}{view === 'progress' && <PlaceholderView eyebrow="ROAM / PROGRESS" title="Progress" copy="See how much of your neighborhoods, city, and region you have uncovered." />}</div><nav className="bottom-nav" aria-label="Primary navigation">{([['map', '◈', 'MAP'], ['sessions', '⌁', 'SESSIONS'], ['progress', '▦', 'PROGRESS']] as const).map(([key, icon, label]) => <button key={key} className={view === key ? 'nav-item nav-item--active' : 'nav-item'} onClick={() => setView(key)} type="button"><span className="nav-icon">{icon}</span><span>{label}</span></button>)}</nav></main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
