import { createRoot } from 'react-dom/client';
import { Installation } from './Installation';
import './styles/installation.css';

const container = document.getElementById('installation-root');
if (!container) throw new Error('Missing #installation-root');

// Intentionally not wrapped in StrictMode: its double-invoked effects would tear
// down and rebuild the WebGL context on every dev mount, which is exactly the
// thing this entry point exists to keep stable.
createRoot(container).render(<Installation />);
