// Used only by scripts/demo/start.ps1: the regular dev config with the /api proxy pointed at the demo API.
// The regular vite.config.ts is untouched.
import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config.ts'

const apiOrigin = process.env.CONGRESS_DEMO_API_ORIGIN
if (!apiOrigin) throw new Error('CONGRESS_DEMO_API_ORIGIN is required (set by scripts/demo/start.ps1)')

export default defineConfig(
  mergeConfig(base, { server: { proxy: { '/api': apiOrigin } } }),
)
