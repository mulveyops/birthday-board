import ReactDOM from 'react-dom/client';
import Root from './Root';
import 'leaflet/dist/leaflet.css';
import './index.css';

// No StrictMode: react-leaflet + Leaflet double-mount awkwardly in dev under StrictMode.
ReactDOM.createRoot(document.getElementById('root')!).render(<Root />);
