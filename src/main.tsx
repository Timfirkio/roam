import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  return (
    <main className="roam-shell">
      <section className="hero-card">
        <p className="eyebrow">ROAM / EARLY BUILD</p>
        <h1>Find more of your own city.</h1>
        <p className="lede">
          A map-first exploration game for walking and riding. Start a session
          to reveal the roads you have travelled.
        </p>
        <button type="button" disabled>
          Map shell coming next
        </button>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
