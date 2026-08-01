import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
  // Build-time literal substitution, read by src/version.js. Set by the
  // Docker build (see frontend/Dockerfile and .github/workflows/deploy.yml);
  // absent in local dev, where the 'dev' / 'unknown' fallback applies.
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || 'dev'),
    __GIT_SHA__: JSON.stringify(process.env.GIT_SHA || 'unknown'),
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
  },
})
