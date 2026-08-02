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

### Changed
- Vite now builds two entry points; Three.js is split into its own vendor chunk.

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
