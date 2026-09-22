import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const areaApiProxyTarget = process.env.AREA_API_PROXY_TARGET ?? 'https://areas.timplummer.co';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: { '/api/areas': { target: areaApiProxyTarget, changeOrigin: true } },
  },
});
