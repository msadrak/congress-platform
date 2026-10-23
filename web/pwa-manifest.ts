import type { ManifestOptions } from 'vite-plugin-pwa'

/**
 * The web app manifest, kept apart from vite.config.ts so a unit test can pin it (tests/pwaManifest.test.ts).
 * One manifest serves every portal (passes, booths, desk, scanner): name the platform, not the scanner.
 */
export const webManifest: Partial<ManifestOptions> = {
  name: 'AI Teb Congress',
  short_name: 'Congress',
  description: 'AI Teb congress platform: digital passes, offline gate scanning, reception and exhibitor lead capture',
  theme_color: '#0E0C2B',
  background_color: '#0E0C2B',
  display: 'standalone',
  // Scanners live in cases, on stands and on lanyards, in either orientation; never lock it.
  orientation: 'any',
  // The installed app's identity. Without it the identity is derived from start_url, so changing start_url
  // below would turn every existing home-screen install into a different app.
  id: '/',
  // Only a home-screen launch opens this address; src/lib/launchTarget.ts rewrites it to the device's own
  // scanner point (or the plain home page) before the app renders. Keep in step with HOME_SCREEN_START_URL.
  start_url: '/?source=pwa',
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
}
