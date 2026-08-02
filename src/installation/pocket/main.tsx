import ReactDOM from 'react-dom/client';
import PocketApp from './PocketApp';

/** Entry for the shareable pocket edition — both pieces behind one chooser. */
ReactDOM.createRoot(document.getElementById('root')!).render(<PocketApp />);

window.addEventListener('contextmenu', (event) => event.preventDefault());
