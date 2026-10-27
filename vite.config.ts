import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true'
      ? null
      : {
          ignored: [
            // Solo la carpeta de datos del servidor. Ojo: `**/data/**` también
            // ignoraba src/data y dejaba el esquema y las plantillas sin HMR.
            'data/**',
            'public/catalog/**',
          ],
        },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
});
