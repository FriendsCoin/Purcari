import ReactDOM from 'react-dom/client';
import IndoorApp from './IndoorApp';

/**
 * Entry point for the château touchscreen. Deliberately separate from the
 * analytical dashboard's entry so the kiosk build ships only what it renders.
 *
 * StrictMode is off here on purpose: its double-invocation remounts every WebGL
 * scene and re-runs the sensor start-up on load, which on a kiosk means a visible
 * hitch on the wall every time the piece resets.
 */
ReactDOM.createRoot(document.getElementById('root')!).render(<IndoorApp />);

// Kiosk hygiene: suppress the context menu and pinch-zoom, which visitors trigger
// constantly on a touch panel and which have no meaning inside the piece.
window.addEventListener('contextmenu', (event) => event.preventDefault());
window.addEventListener(
  'gesturestart',
  (event: Event) => event.preventDefault(),
  { passive: false },
);
