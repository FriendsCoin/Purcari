# Purcari Biodiversity Dashboard

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![React](https://img.shields.io/badge/React-18.3-61dafb.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178c6.svg)

An interactive data visualization dashboard for analyzing biodiversity monitoring data at the Purcari Winery in Moldova. This application processes wildlife observation data from camera traps and BirdNET audio recordings, providing insights into species diversity, temporal patterns, and ecological interactions.

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
