import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@types': path.resolve(__dirname, './src/types'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@services': path.resolve(__dirname, './src/services'),
      '@assets': path.resolve(__dirname, './src/assets'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      // Two entry points: the analytics dashboard, and the touchscreen
      // installation that runs on the panel in the château. They share nothing
      // but the repository, so the kiosk bundle never carries Leaflet or Recharts.
      input: {
        main: path.resolve(__dirname, 'index.html'),
        installation: path.resolve(__dirname, 'installation.html'),
      },
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'map-vendor': ['leaflet', 'react-leaflet'],
          'ui-vendor': ['lucide-react'],
          'three-vendor': ['three'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['leaflet', 'react-leaflet'],
  },
});
