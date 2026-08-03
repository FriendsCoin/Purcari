# Purcari Biodiversity Dashboard

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![React](https://img.shields.io/badge/React-18.3-61dafb.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178c6.svg)

An interactive data visualization dashboard for analyzing biodiversity monitoring data at the Purcari Winery in Moldova. This application processes wildlife observation data from camera traps and BirdNET audio recordings, providing insights into species diversity, temporal patterns, and ecological interactions.

## Living Archive — the installation

The front door of the app is **Живой архив**, a WebGL installation piece built on
the same monitoring data. It renders one particle per real detection — 3 015 of
them — as a single cloud of light that reorganises itself into six readings of
the 2025 season. It is meant to run unattended on a wall or projector as much as
in a browser tab, so it plays itself when nobody is driving.

Open it at `/`; the analytical dashboard lives at `/#dashboard`.

```bash
npm install
npm run dev              # installation on http://localhost:3000
npm run build:standalone # one self-contained HTML file, no server needed
```

`build:standalone` writes `dist-standalone/purcari-living-archive.html` — about
1.6 MB with the code, the styles and both data payloads inlined. It opens from a
`file://` URL and makes no network requests at all, which is what you want on a
gallery machine.

### The six acts

| # | Act | What the cloud becomes |
|---|-----|------------------------|
| 00 | Пролог | A dormant shell of grains behind the title |
| I | Земля | Plumes of light at the ten stations' true coordinates, over the real relief of the estate |
| II | Хронос | A 24-hour dial — acoustic inside, camera traps outside |
| III | Голоса | 136 species as a spiral galaxy, common at the core, single records at the rim, linked where they share a station |
| IV | Станции | Helical columns per station; the five silenced ones burn down to ember and ash |
| V | Индекс | Four land uses as blooms, sized and shaped by their Shannon and Simpson indices |

### The place is the real one

Acts I and IV are staged on an actual basemap of the estate, not a diagram:

- **Relief** from SRTM-derived terrain tiles — the 170 m drop from the vineyard
  plateau to the Dniester floodplain, exaggerated 5.5× so it reads at all.
- **Chateau Purcari** itself, at 46.5295 N 29.8719 E, with the eight buildings of
  the estate around it picked out in gold and lit window by window. The two
  loudest acoustic stations, CT44 and CT47, stand within 200 m of it.
- **192 vineyard parcels**, ~360 ha, each filled with rows running along its own
  long axis — the planting direction, recovered from the parcel's principal axis.
- The **Dniester**, the ponds, the roads and the two villages the estate sits
  between, Purcari and Antonești.

Everything comes from OpenStreetMap and public elevation tiles, is baked once by
`npm run landscape`, and is committed — the app never touches the network. The
map dissolves into haze at the edge of the surveyed area rather than ending in a
cut slab of ground.

Stations sit on the DEM rather than on their recorded altitudes: the field
figures run a consistent ~28 m above the terrain model, which is the usual
geoid-versus-ellipsoid offset for this region. Labels quote the recorded value;
the geometry uses the DEM so nothing floats.

### What the data says

- Two networks, two rhythms: birds peak at **05:00**, mammals at **02:00** — the
  same landscape running two shifts.
- The dial shows **24 discrete tufts** because the acoustic recorder listens for
  ten minutes at the top of each hour. Sampling effort is not equal between the
  networks, and the piece says so rather than smoothing it away.
- Five of ten stations fell silent in June and August 2025. The gap is rendered,
  not hidden.

### Controls

| Input | Action |
|-------|--------|
| `←` `→`, scroll, swipe | Previous / next act |
| `0`–`5` | Jump to an act |
| Space | Toggle autoplay |
| `P` | Play the season back day by day |
| Drag the 24 h track | Narrow the cloud to a slice of the day |
| Click the track / `Esc` | Reset to the full day |
| Hover a panel row | Focus those grains in the cloud |

Left idle for 45 seconds the piece resumes autoplay on its own.

### How it is built

No new dependencies: `@react-three/fiber` drives raw `three`, with a custom GLSL
point shader doing the morphing, drift, pointer repulsion, time filtering and the
act II radar sweep on the GPU. Post-processing is three's own `EffectComposer` —
bloom, then a film pass for grain, vignette and chromatic aberration. Labels are
DOM elements projected each frame, so the typography is real text rather than
textures.

The camera never cuts. Between acts it flies a bowed Bézier around the subject
while bloom, exposure and lens aberration lift on a `sin(πt)` bell, so a move
reads as travel rather than a dissolve. Nothing is mounted or unmounted mid-
transition — every layer cross-fades.

Terrain, parcels and buildings are triangulated and draped at load time by
`landscapeGeometry.ts`, including an ear-clipping triangulator and a scanline row
filler, both dependency-free. `scripts/fetch-landscape.mjs` decodes the DEM
tiles' PNGs by hand (zlib plus the five PNG filters) for the same reason.

Two build steps, both committed so a clone runs offline:

```
npm run data       # public/installation.json from the E1C exports
npm run landscape  # public/landscape.json from OSM + elevation tiles
```

`data` runs automatically before `dev` and `build`; `landscape` is manual, since
it goes out to the network and its result rarely changes.

Source lives in `src/installation/` — `layouts.ts` holds the act geometry,
`acts.ts` the score, `projection.ts` the single shared geo projection, `gl/` the
renderer, `ui/` the chrome.

## Features

- **Interactive Map Visualization** - Leaflet-based mapping with hotspot markers and heatmaps
- **Data Analysis** - Comprehensive analysis of species diversity, temporal patterns, and habitat usage
- **Hypothesis Testing** - Statistical analysis of biodiversity hypotheses with confidence intervals
- **Project Recommendations** - AI-powered suggestions for art installations based on data insights
- **Real-time Filtering** - Dynamic data filtering by time range, species type, and location
- **Export Capabilities** - Export analysis results to CSV and other formats
- **Responsive Design** - Mobile-friendly interface with Tailwind CSS
- **Accessibility** - WCAG 2.1 compliant with keyboard navigation support

## Technology Stack

- **Frontend Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Mapping**: Leaflet with React-Leaflet
- **Charts**: Recharts
- **Icons**: Lucide React
- **Testing**: Jest + React Testing Library
- **Code Quality**: ESLint + Prettier

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0

### Installation

```bash
# Clone the repository
git clone https://github.com/FriendsCoin/Purcari.git
cd Purcari

# Install dependencies
npm install

# Start development server
npm run dev
```

The application will be available at `http://localhost:3000`

### Building for Production

```bash
# Type check
npm run type-check

# Run linter
npm run lint

# Build the project
npm run build

# Preview production build
npm run preview
```

## Project Structure

```
purcari-biodiversity-dashboard/
├── src/
│   ├── components/          # React components
│   │   ├── common/         # Reusable UI components
│   │   ├── dashboard/      # Dashboard-specific components
│   │   ├── map/            # Map-related components
│   │   ├── projects/       # Project recommendation components
│   │   └── analysis/       # Data analysis components
│   ├── hooks/              # Custom React hooks
│   ├── services/           # API and data services
│   ├── types/              # TypeScript type definitions
│   ├── utils/              # Utility functions
│   ├── assets/             # Static assets
│   │   ├── styles/         # Global styles
│   │   └── images/         # Images and icons
│   └── __tests__/          # Test files
├── public/                 # Public static files
├── data (1).geojson        # Wildlife observation data
├── index.html              # Original HTML dashboard (legacy)
├── purcari_data_analysis.tsx  # Original TSX component (legacy)
├── 250918_Purcari_prelimenary_analysis_V01.pdf  # Analysis document
├── package.json            # Project dependencies
├── tsconfig.json           # TypeScript configuration
├── vite.config.ts          # Vite configuration
├── tailwind.config.js      # Tailwind CSS configuration
└── README.md               # This file
```

## Data Format

The application processes GeoJSON data with the following structure:

```json
{
  "count": 2665,
  "items": [
    {
      "id": "unique-id",
      "title": "Species Name",
      "startdate": "2025-08-16T03:32:08.000Z",
      "enddate": "2025-08-16T03:32:20.000Z",
      "geojson": {
        "type": "Point",
        "coordinates": [29.8767, 46.50326]
      },
      "properties": {
        "sensor": { "ref": "ct45" },
        "isnight": true,
        "classification": {
          "countManual": 1,
          "taxrefManual": "species-code"
        }
      }
    }
  ]
}
```

## Development

### Code Quality

```bash
# Run linter
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format

# Check formatting
npm run format:check
```

### Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm test:watch

# Generate coverage report
npm test:coverage
```

## Key Features Explained

### 1. Interactive Map

The map component displays camera trap locations and observation points across the Purcari vineyard. Features include:

- Marker clustering for better performance
- Heatmap visualization of activity density
- Custom popups with species information
- Filter by species type and time range

### 2. Data Analysis

Comprehensive analysis tools include:

- **Species Diversity Metrics**: Shannon index, Simpson's index, species richness
- **Temporal Patterns**: Hourly, daily, and seasonal activity patterns
- **Spatial Analysis**: Hotspot identification and comparison
- **Hypothesis Testing**: Statistical validation of ecological hypotheses

### 3. Hypothesis Testing

The application tests several ecological hypotheses:

1. **Water Proximity → Bird Diversity**: Areas near water sources show higher bird diversity
2. **Nocturnal Mammals**: Mammalian activity peaks at night
3. **Breeding Season Peak**: Bird detections peak during May-June breeding season
4. **Forest Edge Biodiversity**: Edge habitats support higher species diversity
5. **Temporal Niche Partitioning**: Predator-prey pairs show temporal separation

### 4. Project Recommendations

AI-powered recommendations for data-driven art installations:

- **The Living Clock**: 24-hour biodiversity visualization
- **Species Network**: Interactive ecosystem web
- **Soundscape Timeline**: Audio journey through monitoring period
- **Rarity Hunt**: Gamified species collection app
- **Temporal Layers**: Particle-based seasonal visualization

## Performance Optimizations

- Code splitting for faster initial load
- Lazy loading of components
- Memoization of expensive computations
- Virtual scrolling for large datasets
- Optimized map rendering

## Accessibility

- ARIA labels and roles
- Keyboard navigation support
- High contrast mode
- Screen reader compatibility
- Focus management

## Browser Support

- Chrome/Edge (last 2 versions)
- Firefox (last 2 versions)
- Safari (last 2 versions)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- **Purcari Winery** - For providing biodiversity monitoring data
- **Every1Counts** - Data collection platform
- **BirdNET** - Audio species identification
- Camera trap volunteers and researchers

## Contact

For questions or support, please contact:
- Project Repository: https://github.com/FriendsCoin/Purcari
- Email: biodiversity@purcari.wine

## Changelog

### Version 2.0.0 (Current)

- Complete TypeScript rewrite
- Modular component architecture
- Improved performance and code quality
- Enhanced accessibility
- Comprehensive testing
- Modern build system with Vite

### Version 1.0.0 (Legacy)

- Initial HTML/React dashboard
- Basic data visualization
- Map integration
- Hypothesis testing framework

---

Made with ❤️ for biodiversity conservation
