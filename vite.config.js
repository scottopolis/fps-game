import { defineConfig } from 'vite'

// The orb portal serves the dev server under its own hostname.
export default defineConfig({ server: { allowedHosts: true } })
