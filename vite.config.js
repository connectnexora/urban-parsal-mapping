import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Local-only dashboard: no external tile servers, fonts, or APIs.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  }
})
