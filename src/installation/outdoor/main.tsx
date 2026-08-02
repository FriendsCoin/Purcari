import ReactDOM from 'react-dom/client';
import OutdoorApp from './OutdoorApp';

/**
 * Entry point for the outdoor sensor piece. Same reasoning as the indoor entry:
 * no StrictMode, because remounting would restart the camera and microphone
 * streams and reset the visitor's accumulated stillness mid-experience.
 */
ReactDOM.createRoot(document.getElementById('root')!).render(<OutdoorApp />);

window.addEventListener('contextmenu', (event) => event.preventDefault());
window.addEventListener(
  'gesturestart',
  (event: Event) => event.preventDefault(),
  { passive: false },
);
