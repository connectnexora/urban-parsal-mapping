import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Optional: lets the frontend call the backend without CORS in dev.
      // The app also supports VITE_API_URL for a direct backend URL.
      '/api': 'http://localhost:8000',
      '/detect': 'http://localhost:8000',
      '/outputs': 'http://localhost:8000',
    },
  },
});
