import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

function getAppVersion() {
  if (process.env.APP_VERSION) return process.env.APP_VERSION
  try {
    const script = resolve(__dirname, '../scripts/get-version.sh')
    if (existsSync(script)) {
      return execSync(`bash "${script}"`, { encoding: 'utf8' }).trim()
    }
  } catch {
    // fallback
  }
  try {
    const versionFile = resolve(__dirname, '../VERSION')
    if (existsSync(versionFile)) {
      return readFileSync(versionFile, 'utf8').trim()
    }
  } catch {
    // fallback
  }
  return 'dev'
}

function getGitSha() {
  if (process.env.GIT_SHA) return process.env.GIT_SHA
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

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
  // falls back to get-version.sh / git / VERSION in local dev.
  define: {
    __APP_VERSION__: JSON.stringify(getAppVersion()),
    __GIT_SHA__: JSON.stringify(getGitSha()),
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
  },
})
