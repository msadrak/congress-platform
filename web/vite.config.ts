import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Same-origin in the browser, so no CORS configuration is needed in dev.
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
})
