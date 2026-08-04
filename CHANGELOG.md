# Changelog

All notable changes to the Purcari Biodiversity Dashboard will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Le Chœur — touchscreen installation
- New standalone entry point (`installation.html`) for the wall-mounted panel in
  the château, built on raw Three.js with hand-written GLSL and a custom
  post-processing chain. Shares no code with the dashboard bundle.
- Five chapters driven by the real survey: an attract state whose particle ring
  is ordered by time of day, the five recording stations on their true
  coordinates, a 24-hour dial where the spikes are the hourly histogram, a
  121-species constellation laid out by circadian rhythm, and the seventeen-day
  arc of the recording effort.
- Multi-touch interaction throughout — drag, flick with inertia, tap to select,
  up to six simultaneous touches deforming the particle fields.
- Kiosk behaviour: idle return to the attract chapter, adaptive render scale,
  fullscreen on first touch, and a four-tap service corner exposing frame rate
  and render statistics for commissioning.
- `scripts/build-installation-atlas.mjs` bakes the 3.4 MB GeoJSON export into a
  51 KB atlas so the panel draws its first frame immediately (`npm run atlas`).
- Documentation in `docs/INSTALLATION.md`.

#### Chapter I — the estate as a map
- Chapter I is an aerial map of the estate with the recorders marked where they
  actually stand: drag to pan, pinch to zoom, tap a marker to fly to it, and a
  scale bar in the masthead that tracks the zoom.
- `scripts/fetch-basemap.mjs` stitches Esri World Imagery into two levels
  (`npm run basemap`): a wide 1.64 m/px layer covering everything the camera can
  reach, and a 0.82 m/px layer over the station corridor laid on top of it and
  feathered at its edges. Both are committed, so a clone runs offline.
- The map mesh carries a texture coordinate per layer per vertex computed from
  the real Web Mercator projection, so the imagery lands exactly where the
  coordinates say it should and the two layers land on each other.
- `scripts/fetch-terrain.mjs` still bakes a 72x72 grid of NASA SRTM 30 m
  elevations (`npm run terrain`); the figures are quoted in the readouts, which
  is where they are honest.
- Château Purcari added at its real coordinates and selectable like the
  stations. Its readout gives its altitude and its distance to the nearest
  recorder.
- The imagery corrected the chapter's own story. ct47, the recorder that logged
  more than any other, stands at the two ponds in the estate park about 120 m
  from the château — not on the Dniester floodplain three kilometres north, as
  the elevation model alone had suggested. That is where the herons, bitterns,
  crakes and little bitterns come from.

#### Chapter V — Chevauchement
- New chapter built from the Every1Counts ten-month camera-trap analysis: 18
  species as a ring of chords, warm where two species share their hours and cool
  where they avoid each other, with the highlight walking the ring on its own.
- The ring order is the dominant eigenvector of the correlation matrix, not a
  layout choice. It separates eight mammals from ten birds unaided, places the
  red fox at almost exactly zero and files the dog with the birds.
- `scripts/extract-overlap-matrix.mjs` recovers the matrix from the deck's
  rendered heatmap, validated against the RdBu ramp, an exactly +1 diagonal and
  matrix symmetry — all three enforced, symmetry currently exact at 0.000.
- Readouts can now carry `period`, `source` and `legend`, so the masthead and
  footer follow the chapter. Chapter V is a different survey from the other four
  and the overlay no longer labels it with the acoustic dates.

#### Motion
- Chapter transitions rebuilt: the outgoing image recedes while the incoming one
  settles forward, a noise-warped diagonal front carries a band of light across
  the frame, and the lens dispersion and exposure lift as it passes.
- Opening camera moves for Circadien and Espèces.
- The chorus wave is now a comet — sharp leading edge, decaying tail — and lifts
  the ring as it passes. Caustics added to the Flux ribbon.

### Changed
- Vite now builds two entry points; Three.js is split into its own vendor chunk.
- Five chapters became six.
- A soft scrim behind the masthead and the readout. The abstract chapters fall
  away to black at their own edges, but the map puts a lit winery roof wherever
  it likes and the type has to stay legible over it.

### Removed
- The three-dimensional landform in Chapter I, and with it the procedural line
  model of the château. The elevation data was right — the ground does fall
  about 130 m from the vineyard plateau to the river — but that is over 3.1 km,
  a four percent grade, and the chapter drew it with seven times vertical
  exaggeration, which turned a gentle slope into a cliff with the château
  perched on it. The building's footprint was exaggerated six times to
  compensate. A photograph cannot misrepresent the ground that way.

### Fixed
- Chapter dissolves run on wall-clock time rather than the clamped simulation
  delta; on a machine rendering at two frames a second the 1.4 s crossfade was
  stretching to twenty seconds, with both chapters drawing throughout.
- The scale bar tracks the camera. It came through React state, which only
  re-renders when the readout's identity changes, so it froze at whatever the
  altitude was when the chapter was entered — and the rule was drawn at a fixed
  length that did not match its own label. It is now written straight to the DOM
  each frame, like the selection marker, and drawn at its true length.
- The camera cannot pan or zoom off the imagery: the altitude ceiling and the
  pan limits are derived from the same frustum reach, so clamping one no longer
  lets the other run past the edge of the map.

## [2.0.0] - 2025-11-09

### Added

#### Core Infrastructure
- Complete TypeScript migration with strict type checking
- Modern build system with Vite for faster development and optimized production builds
- Comprehensive ESLint and Prettier configuration for code quality
- Jest testing framework with React Testing Library
- CI/CD pipeline with GitHub Actions
- Environment variable configuration system

#### Project Structure
- Modular component architecture with separation of concerns
- Custom React hooks for state management
- Utility functions for data processing and validation
- Centralized type definitions
- Organized directory structure (components, hooks, services, utils, types)

#### Components
- Reusable UI components (Button, Card, Modal)
- Common component library for consistent design
- Accessibility improvements (ARIA labels, keyboard navigation)
- Responsive design with Tailwind CSS

#### Documentation
- Comprehensive README with installation and usage instructions
- Contributing guidelines (CONTRIBUTING.md)
- Detailed changelog (this file)
- Code documentation with JSDoc comments
- MIT License

#### Development Tools
- Hot module replacement for faster development
- Source maps for easier debugging
- Code splitting for optimized bundle size
- TypeScript path aliases for cleaner imports

#### Data Processing
- Enhanced GeoJSON data processing
- Data validation utilities
- Export functionality to CSV
- Diversity metrics calculations (Shannon, Simpson indices)
- Temporal pattern analysis

### Changed
- Migrated from inline HTML/React to modular TypeScript application
- Improved performance with code splitting and lazy loading
- Enhanced error handling and validation
- Better state management with custom hooks
- Updated dependencies to latest stable versions

### Deprecated
- Legacy index.html moved to index.legacy.html
- Legacy purcari_data_analysis.tsx moved to purcari_data_analysis.legacy.tsx

### Fixed
- Type safety issues with proper TypeScript definitions
- Component re-render performance issues
- Map rendering and interaction bugs
- Data processing edge cases

### Security
- Input sanitization to prevent XSS attacks
- File upload validation
- Secure environment variable handling
- HTTPS enforcement for production

## [1.0.0] - 2025-09-18

### Added
- Initial HTML-based dashboard
- React components for data visualization
- Leaflet map integration
- Biodiversity data analysis
- Hypothesis testing framework
- Project recommendation system
- Mock data generation
- Basic filtering capabilities

### Features
- Interactive map with hotspot markers
- Species diversity analysis
- Temporal activity patterns
- Project recommendations for art installations
- Hypothesis validation system

---

## Unreleased

### Planned Features
- Real-time data synchronization
- Advanced filtering and search
- Data export in multiple formats (JSON, Excel, PDF)
- User authentication and personalization
- Mobile app companion
- Multilingual support (English, Romanian, Russian, French)
- Advanced statistical analysis
- Machine learning-based predictions
- API integration with Every1Counts platform
- Collaborative features (comments, annotations)
- Customizable dashboards
- Data comparison tools
- Historical trend analysis
- Automated report generation

### Future Improvements
- Progressive Web App (PWA) capabilities
- Offline mode support
- Enhanced accessibility features
- Performance optimizations
- Extended browser support
- Dark mode theme
- Print-friendly layouts
- Keyboard shortcuts
- Tour/onboarding flow for new users

---

[2.0.0]: https://github.com/FriendsCoin/Purcari/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/FriendsCoin/Purcari/releases/tag/v1.0.0
