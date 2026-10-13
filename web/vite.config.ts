import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      // Only precache the app shell (including self-hosted fonts); never cache API responses or bearer tokens
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Client-side SPA routes: serve index.html for all navigation requests
        // that don't match a precached file (enables offline /scan/:pointId)
        navigateFallback: '/index.html',
        navigateFallbackAllowlist: [/^\/(?!api\/).*/],
        // Explicitly exclude API routes from any runtime caching
        navigateFallbackDenylist: [/^\/api\//],
        // Do not precache source maps
        globIgnores: ['**/*.map'],
        // Clean up old precaches on activate
        cleanupOutdatedCaches: true,
        // Skip waiting is NOT set — we use prompt registration so the operator
        // controls when to apply updates (preserving in-flight scan state)
      },
      manifest: {
        name: 'Congress Scanner',
        short_name: 'Scanner',
        description: 'Offline-capable gate scanner for Congress Management Platform',
        theme_color: '#0E0C2B',
        background_color: '#0E0C2B',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Same-origin in the browser, so no CORS configuration is needed in dev.
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  preview: {
    host: '0.0.0.0',
    port: 5180,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
})
