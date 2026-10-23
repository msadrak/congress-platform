import { execSync } from 'node:child_process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { webManifest } from './pwa-manifest.ts'

// Overridable so disposable stacks (scripts/integration/*) can point a preview at their own API port.
const apiOrigin = process.env.CONGRESS_API_ORIGIN ?? 'http://127.0.0.1:8000'

// The build id gate devices show and report (heartbeat), so staff can see that every scanner runs the same
// build: CONGRESS_APP_BUILD (e.g. the commit, passed by the image build), else the checkout's short commit, else
// the build time.
function appBuild(): string {
  const given = process.env.CONGRESS_APP_BUILD?.trim()
  if (given) return given.slice(0, 24)
  try {
    return execSync('git rev-parse --short=10 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  }
}

export default defineConfig({
  define: {
    __APP_BUILD__: JSON.stringify(appBuild()),
  },
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
      // Defined in pwa-manifest.ts so a unit test can pin it.
      manifest: webManifest,
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Same-origin in the browser, so no CORS configuration is needed in dev.
    proxy: { '/api': apiOrigin },
  },
  preview: {
    host: '0.0.0.0',
    port: 5180,
    proxy: { '/api': apiOrigin },
  },
})
