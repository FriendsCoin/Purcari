/**
 * Entry point for the single-file build.
 *
 * Only the installation — no map, no charts, no vision libraries — so the whole
 * piece can be inlined into one self-contained HTML file that runs without a
 * server. See scripts/build-standalone.mjs.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Installation } from './installation/Installation';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Installation />
  </React.StrictMode>
);
