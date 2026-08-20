import { Component, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import Root from './Root';
import 'leaflet/dist/leaflet.css';
import './index.css';

/** A crash must never be a silent white screen — show what broke + a way out. */
class CrashGuard extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#e2e8f0', padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <div style={{ fontSize: '2.2rem' }}>😵</div>
          <h2 style={{ margin: '8px 0' }}>Something broke</h2>
          <p style={{ fontSize: '0.8rem', opacity: 0.8, wordBreak: 'break-word' }}>
            {String(this.state.error?.message ?? this.state.error)}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 14, padding: '12px 26px', borderRadius: 12, border: 'none', background: '#f59e0b', fontWeight: 800, fontSize: '1rem', cursor: 'pointer' }}
          >
            ↻ Reload
          </button>
        </div>
      </div>
    );
  }
}

// No StrictMode: react-leaflet + Leaflet double-mount awkwardly in dev under StrictMode.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <CrashGuard>
    <Root />
  </CrashGuard>,
);
