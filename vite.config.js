import { defineConfig } from 'vite';
import { ephemerisPlugin } from './server/ephemeris.js';

export default defineConfig({
  plugins: [ephemerisPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.replaceAll('\\', '/').includes('three/examples/')) return 'three-controls';
          if (id.includes('node_modules/three/') || id.includes('node_modules\\three\\')) return 'three';
          if (/node_modules[/\\](react|react-dom|scheduler)[/\\]/.test(id)) return 'react';
        },
      },
    },
  },
});
