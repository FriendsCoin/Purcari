# Quick Start Guide

Welcome to the Purcari Biodiversity Dashboard! This guide will help you get up and running in minutes.

## Prerequisites

Before you begin, ensure you have:
- Node.js (version 18 or higher)
- npm (version 9 or higher)
- Git
- A modern web browser (Chrome, Firefox, Safari, or Edge)

Check your versions:
```bash
node --version
npm --version
```

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/FriendsCoin/Purcari.git
cd Purcari
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required packages including React, TypeScript, Vite, and other dependencies.

### 3. Start Development Server

```bash
npm run dev
```

The application will start at `http://localhost:3000`. Your browser should open automatically.

## First Steps

### Loading Data

When you first open the application, you'll see two options:

1. **Upload CSV** - Upload your own biodiversity monitoring data
2. **Use Simulated Data** - Explore with sample data

Click "Use Simulated Data" to start exploring immediately.

### Exploring the Dashboard

The dashboard includes several key areas:

1. **Map View** - Interactive map showing observation hotspots
2. **Species Analysis** - Charts and graphs of species diversity
3. **Temporal Patterns** - Activity patterns over time
4. **Hypotheses** - Scientific hypotheses with statistical validation
5. **Project Recommendations** - Art installation suggestions based on data

### Key Features

- **Filter Data**: Use the filters to view specific time ranges or species types
- **Interactive Map**: Click markers to see detailed information
- **Export Data**: Download analysis results as CSV
- **View Details**: Click on charts and cards for more information

## Development Workflow

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

### Code Quality

```bash
# Check for linting errors
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Format code
npm run format
```

### Type Checking

```bash
npm run type-check
```

### Building for Production

```bash
# Build the application
npm run build

# Preview production build
npm run preview
```

## Project Structure

```
Purcari/
├── src/
│   ├── components/     # React components
│   ├── hooks/          # Custom React hooks
│   ├── utils/          # Utility functions
│   ├── types/          # TypeScript types
│   ├── services/       # Data services
│   └── assets/         # Static assets
├── public/             # Public files
├── data (1).geojson    # Real observation data
└── docs/               # Documentation
```

## Common Tasks

### Adding a New Component

1. Create a new file in `src/components/`
2. Import necessary dependencies
3. Define your component with TypeScript types
4. Export the component
5. Add tests in `__tests__/` directory

Example:
```typescript
// src/components/MyComponent.tsx
interface MyComponentProps {
  title: string;
}

export function MyComponent({ title }: MyComponentProps) {
  return <h1>{title}</h1>;
}
```

### Working with Data

The application processes GeoJSON data. To load custom data:

1. Ensure your data follows the GeoJSON format
2. Place it in the root directory or public folder
3. Use the data processing utilities in `src/utils/dataProcessing.ts`

### Styling

The project uses Tailwind CSS. Add styles using Tailwind classes:

```typescript
<div className="bg-purple-600 text-white p-4 rounded-lg">
  Your content
</div>
```

## Troubleshooting

### Port Already in Use

If port 3000 is already in use, Vite will automatically try the next available port.

### Module Not Found

Try clearing cache and reinstalling:
```bash
rm -rf node_modules package-lock.json
npm install
```

### TypeScript Errors

Run type checking to see all errors:
```bash
npm run type-check
```

### Build Errors

Ensure all dependencies are installed and up to date:
```bash
npm ci
npm run build
```

## Next Steps

- Read the full [README](../README.md) for detailed documentation
- Check [CONTRIBUTING](../CONTRIBUTING.md) to learn how to contribute
- Explore the [examples](./examples/) for code samples
- Join our community discussions

## Getting Help

- **Issues**: Report bugs on [GitHub Issues](https://github.com/FriendsCoin/Purcari/issues)
- **Discussions**: Ask questions in [GitHub Discussions](https://github.com/FriendsCoin/Purcari/discussions)
- **Email**: Contact us at biodiversity@purcari.wine

## Resources

- [React Documentation](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Vite Guide](https://vitejs.dev/guide/)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)
- [Leaflet Documentation](https://leafletjs.com/reference.html)

Happy coding! 🌿
